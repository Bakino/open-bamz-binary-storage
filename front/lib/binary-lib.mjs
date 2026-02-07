export const binaryHelpers = {
    getUrl: (binary) => {
        if(!binary){
            // no binary, give transparent image
            return "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="
        }
        if(binary.data){
            // data inside the image
            return `data:${binary.data};base64,${binary.data}` ;
        }
        let url = "/open-bamz-binary-storage/binary/" + (binary.index_id??binary) ;
        // @ts-ignore
        if(window.SERVER_URL){ // case when not running in browser and server URL is set as global (example : when run in cordova)
            // @ts-ignore
            url = window.SERVER_URL + url ;
        }
        return url ;
    },
};