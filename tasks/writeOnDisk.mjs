import * as path from "path";
import { ensureDir } from "fs-extra" ;
import { writeFile } from "fs/promises";

export default async function(payload, {logger, query}){
    
    const storagePath = process.env.BINARY_STORAGE_PATH ;
    if(!storagePath){
        logger.error("No BINARY_STORAGE_PATH defined") ;
        return ;
    }

    const result = await query(`SELECT current_database() as dbname`);
    const dbName = result.rows[0].dbname ;

    const pathOfFile = path.join(storagePath, dbName, payload.hash.substring(0,2), payload.hash) ;

    const resultBinary = await query(`SELECT * FROM binary_storage.binary_storage WHERE hash = $1`, [payload.hash]);

    if(resultBinary.rows.length === 0){
        logger.info("No binary found for hash " + payload.hash) ;
        return ;
    }

    const data = resultBinary.rows[0].data ;
    if(!data){
        logger.info("No data found for hash " + payload.hash) ;
        return ;
    }

    await ensureDir(path.dirname(pathOfFile)) ;
    await writeFile(pathOfFile, data) ;

    logger.info("stored in disk, delete in db "+payload.hash) ;
    await query(`UPDATE binary_storage.binary_storage SET data = NULL WHERE hash = $1`, [payload.hash]);
}