import express from 'express';
import { readFile, open } from 'fs/promises';
import * as path from 'path';


export const prepareDatabase = async ({ client, grantSchemaAccess }) => {
    

    //need pgcrypto for HASH
    await client.query(`CREATE EXTENSION IF NOT EXISTS pgcrypto`);

    await client.query(`CREATE SCHEMA IF NOT EXISTS binary_storage`);

    await client.query(`create table if not exists binary_storage.settings (
        store_on_disk boolean default false
    )`);

    await client.query(`INSERT INTO binary_storage.settings(store_on_disk)
        SELECT false
        WHERE NOT EXISTS (SELECT * FROM binary_storage.settings)`);

    await client.query(`create table if not exists binary_storage.binary_storage (
        hash varchar(256) primary key,
        data bytea
    )`);
        
    await client.query(`create table if not exists binary_storage.binary_index (
        id uuid primary key default gen_random_uuid(),
        hash varchar(256),
        filename text,
        mimetype text,
        size bigint
    )`);

    // REMOVE UNUSED BINARY
    await client.query(`CREATE OR REPLACE FUNCTION binary_storage.delete_not_used_binary()
RETURNS TRIGGER AS $$
    //delete storage that are not used anymore by any index

    plv8.execute("DELETE FROM binary_storage.binary_storage WHERE hash = $1 AND hash NOT IN (SELECT DISTINCT hash FROM binary_storage.binary_index)", [OLD.hash]) ;
    return NEW || OLD;
$$
LANGUAGE "plv8" SECURITY DEFINER`) ;

    await client.query(`DROP TRIGGER IF EXISTS trigger_after_delete_delete_not_used_binary ON binary_storage.binary_index`);

    await client.query(`CREATE TRIGGER trigger_after_delete_delete_not_used_binary
AFTER DELETE ON binary_storage.binary_index
FOR EACH ROW EXECUTE FUNCTION binary_storage.delete_not_used_binary()`);

    await client.query(`DROP TRIGGER IF EXISTS trigger_after_update_delete_not_used_binary ON binary_storage.binary_index`);

    await client.query(`CREATE TRIGGER trigger_after_update_delete_not_used_binary
AFTER UPDATE ON binary_storage.binary_index
FOR EACH ROW EXECUTE FUNCTION binary_storage.delete_not_used_binary()`);

    // WRITE ON DISK WHEN ADD IN BINARY STORAGE
    await client.query(`CREATE OR REPLACE FUNCTION binary_storage.write_on_disk()
        RETURNS TRIGGER AS $$

            const settings = plv8.execute("SELECT * FROM binary_storage.settings", [])[0];

            if(settings?.store_on_disk){
                plv8.execute("SELECT graphile_worker.add_job('runPluginTask', $1)", 
                    [{plugin: 'open-bamz-binary-storage', task : 'tasks/writeOnDisk.mjs', params: { hash: NEW.hash }}]);
            }


        $$ LANGUAGE "plv8" SECURITY DEFINER`)
        
    await client.query(`DROP TRIGGER IF EXISTS trigger_binary_write_on_disk ON binary_storage.binary_storage`);
        
    await client.query(`CREATE TRIGGER trigger_binary_write_on_disk
        AFTER INSERT ON binary_storage.binary_storage
        FOR EACH ROW EXECUTE FUNCTION binary_storage.write_on_disk()`);

    // DELETE FROM DISK WHEN DELETE FROM BINARY STORAGE
    await client.query(`CREATE OR REPLACE FUNCTION binary_storage.delete_from_disk()
        RETURNS TRIGGER AS $$

            const settings = plv8.execute("SELECT * FROM binary_storage.settings", [])[0];

            if(settings?.store_on_disk){
                plv8.execute("SELECT graphile_worker.add_job('runPluginTask', $1)", 
                    [{plugin: 'open-bamz-binary-storage', task : 'tasks/deleteFromDisk.mjs', params: { hash: OLD.hash }}]);
            }


        $$ LANGUAGE "plv8" SECURITY DEFINER`)
        
    await client.query(`DROP TRIGGER IF EXISTS trigger_binary_delete_from_disk ON binary_storage.binary_storage`);
        
    await client.query(`CREATE TRIGGER trigger_binary_delete_from_disk
        AFTER DELETE ON binary_storage.binary_storage
        FOR EACH ROW EXECUTE FUNCTION binary_storage.delete_from_disk()`);


    /////////////// Create a special column type to save binary


    // Create a dedicated schema for system function so they don't be used in postgraphile

    await client.query(`CREATE SCHEMA IF NOT EXISTS binary_system`) ;
    
    // create the column type bamz_binary (use DOMAIN)
    await client.query(`DO $$
        BEGIN
            IF NOT EXISTS (
                SELECT 1
                FROM pg_type
                WHERE typname = 'bamz_binary'
            ) THEN
                CREATE DOMAIN bamz_binary AS jsonb;
            END IF;
        END $$`)

    // trigger function that create data in binary index / binary storage
    await client.query(`CREATE OR REPLACE FUNCTION binary_system.bamz_binary_row_trigger()
        RETURNS trigger
        AS $$

        function base64ToBytea(b64) {
            return plv8.execute("SELECT decode($1, 'base64') AS b", [b64])[0].b;
        }

        function sha256Hex(bytea) {
            return plv8.execute("SELECT encode(digest($1, 'sha256'), 'hex') AS h",[bytea])[0].h;
        }

        const row = NEW||{};
        const table = plv8.execute(\`
            SELECT column_name
            FROM information_schema.columns
            WHERE table_schema = $1
                AND table_name   = $2
                AND domain_name     = 'bamz_binary'
        \`, [TG_TABLE_SCHEMA, TG_TABLE_NAME]);


        for (const col of table) {
            const key = col.column_name;


            let payload = row[key];
            if(typeof(payload) === "string"){
                try{
                    payload = JSON.parse(payload)  ;
                }catch(err){
                    continue ;
                }
            }

            if(OLD){
                let oldPayload = OLD[key] ;
                if(typeof(oldPayload) === "string"){
                    try{
                        oldPayload = JSON.parse(oldPayload)  ;
                    }catch(err){
                        continue ;
                    }
                }
                if(oldPayload && oldPayload.index_id){
                    // old data has been stored
                    if(!payload || !payload.index_id || payload.data){
                        // no more payload or payload changed, delete old index
                        plv8.execute(\`DELETE FROM binary_storage.binary_index WHERE id = $1\`, [oldPayload.index_id]) ;
                    }
                }
            }

            if(NEW){
                if (!payload || typeof payload !== 'object') {
                    continue;
                }

                if (!payload.data) continue; // already stored

                const bin = base64ToBytea(payload.data);
                const size = bin.length;
                const hash = sha256Hex(bin);

                plv8.execute(\`
                    INSERT INTO binary_storage.binary_storage (hash, data)
                    VALUES ($1, $2)
                    ON CONFLICT (hash) DO NOTHING
                \`, [ hash, bin ]);

                const insertedIndex = plv8.execute(\`
                    INSERT INTO binary_storage.binary_index (hash, filename, mimetype, size)
                    VALUES ($1, $2, $3, $4)
                    RETURNING *
                \`, [ hash, payload.filename, payload.mimetype, size ]);

                

                if(NEW){
                    // remplace JSON
                    NEW[key] = JSON.stringify({
                        index_id: insertedIndex[0].id,
                        filename: payload.filename,
                        mimetype: payload.mimetype,
                        hash,
                        size
                    });
                }
            }

        }

        return NEW||OLD;
    $$  LANGUAGE "plv8" SECURITY DEFINER`);

    // function to test if a table has a bamz_binary column
    await client.query(`CREATE OR REPLACE FUNCTION binary_system.table_has_bamz_binary(
        p_schema text,
        p_table  text
        )
        RETURNS boolean
        
        AS $$
            SELECT EXISTS (
            SELECT 1
            FROM information_schema.columns
            WHERE table_schema = p_schema
                AND table_name   = p_table
                AND domain_name     = 'bamz_binary'
            );
        $$ LANGUAGE sql  SECURITY DEFINER`);

    // function to generate unique trigger name
    await client.query(`CREATE OR REPLACE FUNCTION binary_system.bamz_binary_trigger_name(
        p_schema text,
        p_table  text
        )
        RETURNS text
        IMMUTABLE
        AS $$
            SELECT format(
            'trigger_bamz_binary__%s__%s',
            p_schema,
            p_table
            );
    $$ LANGUAGE sql  SECURITY DEFINER`);

    // function to create trigger on table creation or alter
    await client.query(`CREATE OR REPLACE FUNCTION binary_system.sync_bamz_binary_trigger(
        p_schema text,
        p_table  text
        )
        RETURNS void
        AS $$
        DECLARE
        has_col boolean;
        trigger_name text;
        trigger_exists boolean;
        BEGIN
            trigger_name := binary_system.bamz_binary_trigger_name(p_schema, p_table);

            SELECT binary_system.table_has_bamz_binary(p_schema, p_table)
            INTO has_col;

            SELECT EXISTS (
                SELECT 1
                FROM pg_trigger t
                JOIN pg_class c ON c.oid = t.tgrelid
                JOIN pg_namespace n ON n.oid = c.relnamespace
                WHERE n.nspname = p_schema
                AND c.relname = p_table
                AND t.tgname  = trigger_name
            )
            INTO trigger_exists;

            IF has_col AND NOT trigger_exists THEN
                EXECUTE format(
                'CREATE TRIGGER %I
                BEFORE INSERT OR UPDATE OR DELETE ON %I.%I
                FOR EACH ROW
                EXECUTE FUNCTION binary_system.bamz_binary_row_trigger()',
                trigger_name, p_schema, p_table
            );

            ELSIF NOT has_col AND trigger_exists THEN
                EXECUTE format(
                'DROP TRIGGER %I ON %I.%I',
                trigger_name, p_schema, p_table
                );
            END IF;
        END;
    $$ LANGUAGE plpgsql SECURITY DEFINER`);

    // function for create/alter table event trigger
    await client.query(`CREATE OR REPLACE FUNCTION binary_system.on_ddl_sync_bamz_binary()
        RETURNS event_trigger
        AS $$
        DECLARE
            obj record;
        BEGIN
            FOR obj IN
                SELECT *
                FROM pg_event_trigger_ddl_commands()
                WHERE object_type = 'table'
            LOOP
                PERFORM binary_system.sync_bamz_binary_trigger(
                obj.schema_name,
                obj.objid::regclass::text
                );
            END LOOP;
        END;
        $$ LANGUAGE plpgsql SECURITY DEFINER`);

    // register event trigger to create trigger for bamz_binary columns
    await client.query(`DROP EVENT TRIGGER IF EXISTS trg_sync_bamz_binary`) ;
    await client.query(`CREATE EVENT TRIGGER trg_sync_bamz_binary
        ON ddl_command_end
        WHEN TAG IN ('CREATE TABLE', 'ALTER TABLE')
        EXECUTE FUNCTION binary_system.on_ddl_sync_bamz_binary()`);


    await grantSchemaAccess("binary_storage", [
        { role: "admin", level: "admin" },
        { role: "user", level: "none" },
        { role: "readonly", level: "none" },
    ]) ;
}

export const cleanDatabase = async ({ client }) => {
    await client.query(`drop schema if exists binary_system CASCADE`);
    await client.query(`drop schema if exists binary_storage CASCADE`);

}



export const initPlugin = async ({ app, graphql, hasCurrentPlugin, loadPluginData, logger, runQuery, appFileSystems }) => {
    const router = express.Router();

    router.get("/binary/:id{/:disposition}", async (req, res, next) => {
        if(!hasCurrentPlugin(req.appName)){ return next() ;}
        const id = req.params.id;
        const range = req.headers.range ;


        const result = await runQuery({database: req.appName}, `SELECT index.* FROM binary_storage.binary_index index 
            JOIN binary_storage.binary_storage s ON s.hash = index.hash
            WHERE index.id=$1`, [id]);
        if(result.rows.length === 0){ return res.status(404) ; }


    
        if(result.rows.length === 1){

            const binaryIndex = result.rows[0] ; 

            let sqlData = `SELECT data FROM binary_storage.binary_storage WHERE hash=$1 AND data IS NOT NULL` ;

            let start, end;
            let isRange = false;
            if(range){
                let array = range.split(/bytes=([0-9]*)-([0-9]*)/);
                start = parseInt(array[1]);
                end = parseInt(array[2]);
                if(!isNaN(end)) {
                    start = isNaN(start) ? 0 : start;
                    end = isNaN(end) ? (binaryIndex.size - 1) : end;
        
                    if (start >= end) {
                        res.status(416).send('Requested Range Not Satisfiable');
                    }
                    isRange = true;
                    sqlData = `SELECT SUBSTRING(data from ${start + 1} for ${end - start}) as data FROM binary_storage.binary_storage WHERE hash=$1 AND data IS NOT NULL` ;
                }
            }

            let data;
            const resultData = await runQuery({database: req.appName}, sqlData, [binaryIndex.hash]);
            if(resultData.rows.length === 0){
                const settings = (await runQuery({database: req.appName}, `SELECT * FROM binary_storage.settings`)).rows[0] ;
                if(settings?.store_on_disk){
                    const storagePath = process.env.BINARY_STORAGE_PATH ;
                
                    const pathOfFile = path.join(storagePath, req.appName, binaryIndex.hash.substring(0,2), binaryIndex.hash) ;

                    if(isRange){
                        let fd ;
                        try{
                            const fd = await open(pathOfFile, "r") ;
                            data = await fd.read({buffer: Buffer.alloc(end - start), position: start, length: end - start}) ;
                        }finally{
                            if(fd){
                                // @ts-ignore
                                await fd.close() ;
                            }
                        }
                    }else{
                        data = await readFile(pathOfFile) ;
                    }
                }
            }else{
                data = resultData.rows[0].data ; 
            }

            res.setHeader("Content-Type", binaryIndex.mimetype);
            res.setHeader("Accept-Ranges","bytes") ;
            if(isRange){
                res.setHeader("Content-Range", `bytes ${start}-${end}/${binaryIndex.size}`) ;
                res.setHeader("Content-Length", (end - start)) ;
                res.setHeader("Cache-Control", "no-cache") ;
            }else{
                res.setHeader("Content-Length", binaryIndex.size) ;
                res.setHeader("Content-Disposition", `${req.params.disposition||"inline"}; filename="${binaryIndex.filename}"`);
            }
            res.send(data) ;
        }
    }) ;


   loadPluginData(async ({pluginsData})=>{
        if(pluginsData?.["open-bamz-database"]?.pluginSlots?.dbFieldsExtensions){
            pluginsData?.["open-bamz-database"]?.pluginSlots?.dbFieldsExtensions.push( {
                plugin: "open-bamz-binary-storage",
                extensionPath: "/plugin/open-bamz-binary-storage/lib/db-components-binary.mjs",
            })
        }
        if(pluginsData?.["open-bamz-database"]?.pluginSlots?.dbValuesExtensions){
            pluginsData?.["open-bamz-database"]?.pluginSlots?.dbValuesExtensions.push( {
                plugin: "open-bamz-binary-storage",
                extensionPath: "/plugin/open-bamz-binary-storage/lib/db-value-binary.mjs",
            })
        }

        if(pluginsData?.["open-bamz-viewz"]?.pluginSlots?.viewzExtensions){
            pluginsData?.["open-bamz-viewz"]?.pluginSlots?.viewzExtensions.push( {
                plugin: "open-bamz-binary-storage",
                extensionPath: "/plugin/open-bamz-binary-storage/lib/viewz-binary.mjs"
            })
        }
   });

    return {
        // path in which the plugin provide its front end files
        frontEndPath: "front",
        //lib that will be automatically load in frontend
        frontEndPublic: "lib",
        //frontEndLib: "lib/i18n.mjs",
        router: router,
        //menu entries
        menu: [
            {
                name: "admin", entries: [
                    { name: "Translations", link: "/plugin/open-bamz-i18n/settings" }
                ]
            }
        ],
    }
}