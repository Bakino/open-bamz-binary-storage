export const binaryHelpers = {
    getUrl: (binary) => {
        return "/open-bamz-binary-storage/binary/" + (binary.index_id??binary) ;
    },
};