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
        return "/open-bamz-binary-storage/binary/" + (binary.index_id??binary) ;
    },
};