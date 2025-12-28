import * as path from "path";
import { readdir, rmdir, unlink } from "fs/promises";

export default async function(payload, {logger, query}){
    
    const storagePath = process.env.BINARY_STORAGE_PATH ;
    if(!storagePath){
        logger.error("No BINARY_STORAGE_PATH defined") ;
        return ;
    }

    const result = await query(`SELECT current_database() as dbname`);
    const dbName = result.rows[0].dbname ;

    const pathOfFile = path.join(storagePath, dbName, payload.hash.substring(0,2), payload.hash) ;

    await unlink(pathOfFile) ;
    const files = await readdir(path.dirname(pathOfFile)) ; 
    if(files.length === 0){
        // directory is empty
        await rmdir(path.dirname(pathOfFile)) ;
    }

}