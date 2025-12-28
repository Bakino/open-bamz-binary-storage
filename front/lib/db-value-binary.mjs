import { preview } from "./db-components-binary.mjs";


export default {
    defaultExtension: null,
    formatValue: async function({type, value, dbApi, schema, column}){
        if(type === "bamz_binary"){
            if(value){
                return value.filename+" ("+value.mimetype+")" ;
            }
        }
        return this.defaultExtension.formatValue({type, value, dbApi, schema, column}) ;
    },


    setValue: function({type, elValue, value, formattedValue}){
        if(type === "bamz_binary" && elValue){
            elValue.style.maxWidth = "20px";
            elValue.style.display = "inline-block";
            preview({elPreview: elValue, value}) ;
        }else{
            this.defaultExtension.setValue({type, elValue, value, formattedValue}) ;
        }
    }, 
    customCss: "https://cdn.jsdelivr.net/npm/file-icon-vectors@1.0.0/dist/file-icon-vivid.min.css"
}