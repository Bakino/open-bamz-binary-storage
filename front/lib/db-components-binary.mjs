const toBase64 = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    // @ts-ignore
    reader.onload = () => resolve(reader.result.substring(reader.result.indexOf("base64,")+"base64,".length));
    reader.onerror = reject;
});


export async function preview({elPreview, value}){
    elPreview.innerHTML = "" ;
    if(value){
        if(value?.mimetype?.startsWith("image/")){
            if(value?.data){
                elPreview.innerHTML = `<img style="max-height: 100%; max-width: 100%" src="data:${value.mimetype};base64,${value.data}" />` ;
            }else if(value?.index_id){
                const response = await fetch("/open-bamz-binary-storage/binary/"+value.index_id) ;
                const blob = await response.blob() ;
                const base64 = await toBase64(blob) ;
                elPreview.innerHTML = `<img style="max-height: 100%; max-width: 100%" src="data:${value.mimetype};base64,${base64}" />` ;
            }
        }else{
            let extensionClass = "";
            if(value.filename){
                const indexDot = value.filename.lastIndexOf(".") ;
                if(indexDot !== -1){
                    extensionClass = "fiv-icon-"+value.filename.substring(indexDot+1) ;
                }
            }
            elPreview.innerHTML = `<span class="fiv-viv fiv-icon-blank ${extensionClass}"></span>` ;        
        }
    }
}

function applyValue({value, elInput}){
    const elPreview = /** @type {HTMLDivElement} */ (elInput.querySelector(".bamz-binary-preview")) ;
    const elIcons = /** @type {HTMLDivElement} */ (elInput.querySelector(".bamz-binary-icons")) ;
    const elInfos = elInput.querySelector(".bamz-binary-infos") ;
    if(value){
        elIcons.style.display = "flex" ;
        elInput.value = value ;
        elInfos.innerHTML = value.filename+" ("+value.mimetype+")" ;
        elPreview.style.width = "35px";
        elPreview.style.marginRight = "5px";
        elPreview.style.fontSize = "40px";
    }else{
        elInfos.innerHTML = "" ;
        elIcons.style.display = "none" ;  
        elPreview.style.width = "0px";
        elPreview.style.marginRight = "0px";
    }
    preview({elPreview, value}) ;
}

export default {
    defaultExtension: null,
    generateInputElement: async function({label, type, schema, table, column, el, placeholder, dbApi}){
        if(type === "bamz_binary"){
            const elBinary = /** @type {HTMLDivElement} */ (document.createElement("DIV")) ;
            elBinary.style.display = "flex" ;

            // icons
            const elIcons = /** @type {HTMLDivElement} */ (document.createElement("DIV")) ;
            elIcons.className = "bamz-binary-icons" ;
            elIcons.style.display = "none" ;  
            elIcons.style.flexDirection = "column" ;

            // download icon
            const btDownload = /** @type {HTMLDivElement} */ (document.createElement("DIV")) ;
            btDownload.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-cloud-arrow-down-fill" viewBox="0 0 16 16">
                <path d="M8 2a5.53 5.53 0 0 0-3.594 1.342c-.766.66-1.321 1.52-1.464 2.383C1.266 6.095 0 7.555 0 9.318 0 11.366 1.708 13 3.781 13h8.906C14.502 13 16 11.57 16 9.773c0-1.636-1.242-2.969-2.834-3.194C12.923 3.999 10.69 2 8 2m2.354 6.854-2 2a.5.5 0 0 1-.708 0l-2-2a.5.5 0 1 1 .708-.708L7.5 9.293V5.5a.5.5 0 0 1 1 0v3.793l1.146-1.147a.5.5 0 0 1 .708.708"/>
            </svg>` ;
            btDownload.style.cursor = "pointer" ;
            btDownload.className = "bamz-binary-download" ;
            btDownload.addEventListener("click", async ()=>{
                // @ts-ignore
                const value =  elBinary.value ;
                let url ;
                if(value.data){
                    url = `data:${value.mimetype};base64,${value.data}` ;
                }else{
                    url = `/open-bamz-binary-storage/binary/${value.index_id}` ;
                }
                const res = await fetch(url) ;
                const blob = await res.blob() ;
                const a = /** @type {HTMLAnchorElement} */ (document.createElement("A")) ;
                a.href = URL.createObjectURL(blob) ;
                a.download = value.filename ;
                a.click() ;
            }) ;
            elIcons.appendChild(btDownload) ;

            const btReset = /** @type {HTMLDivElement} */ (document.createElement("DIV")) ;
            btReset.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" fill="currentColor" class="bi bi-x-circle" viewBox="0 0 16 16">
                <path d="M8 15A7 7 0 1 1 8 1a7 7 0 0 1 0 14m0 1A8 8 0 1 0 8 0a8 8 0 0 0 0 16"/>
                <path d="M4.646 4.646a.5.5 0 0 1 .708 0L8 7.293l2.646-2.647a.5.5 0 0 1 .708.708L8.707 8l2.647 2.646a.5.5 0 0 1-.708.708L8 8.707l-2.646 2.647a.5.5 0 0 1-.708-.708L7.293 8 4.646 5.354a.5.5 0 0 1 0-.708"/>
            </svg>` ;
            btReset.style.color = "red" ;
            btReset.style.cursor = "pointer" ;
            btReset.className = "bamz-binary-reset" ;
            btReset.addEventListener("click", async ()=>{
                // @ts-ignore
                elBinary.value = null;
                elBinary.dispatchEvent( new Event("change", {bubbles: true}) ) ;
                applyValue({value: null, elInput: elBinary})
            }) ;
            elIcons.appendChild(btReset) ;



            const elInfosAndInput = /** @type {HTMLDivElement} */ (document.createElement("DIV")) ;
            elInfosAndInput.style.flexGrow = "1" ;


            const elPreview = /** @type {HTMLDivElement} */ (document.createElement("DIV")) ;
            elPreview.className = "bamz-binary-preview"
            const elInfos = /** @type {HTMLDivElement} */ (document.createElement("DIV")) ;
            elInfos.className = "bamz-binary-infos"
            const elInput = /** @type {HTMLInputElement} */ (document.createElement("INPUT")) ;
            elInput.id = el.id+"_input" ;
            elInput.type = "file" ;
            elInput.addEventListener("change", async ()=>{
                elInfos.innerHTML = "..."
                elInput.setCustomValidity("File is loading") ;
                try{
                    const file = elInput.files[0];
                    // @ts-ignore
                    if(elInput.currentFile !== file){
                        // @ts-ignore
                        elInput.currentFile = file ;
                        if(!file){
                            //elInfos.innerHTML = ""
                            //elInput.value = "" ;
                            // @ts-ignore
                            elBinary.value = null;
                        }else{
                            //elInfos.innerHTML = file.name+" ("+file.type+")" ;
                            const base64 = await toBase64(file);
                            // @ts-ignore
                            elBinary.value = {
                                data: base64,
                                filename: file.name,
                                mimetype: file.type
                            } ;
                        }
                        elBinary.dispatchEvent(new Event("change", { bubbles: true })) ;
                    }
                }finally{
                    elInput.setCustomValidity("") ;
                }
            });

            elBinary.appendChild(elPreview) ;
            elBinary.appendChild(elInfosAndInput) ;
            elBinary.appendChild(elIcons) ;
            elInfosAndInput.appendChild(elInfos) ;
            elInfosAndInput.appendChild(elInput) ;
            return elBinary ;
        }
        return this.defaultExtension.generateInputElement({label, type, schema, table, column, el, placeholder, dbApi}) ;
    },

    getValue: function({el, type, elInput/*label, type, /*schema, table, column, el, elLabel, elInput*/}){
        if(type === "bamz_binary"){
            // transform input file to base 64
            if(elInput.value){
                return elInput.value ; 
            }else{
                return null;
            }
        }
        return this.defaultExtension.getValue({el, type, elInput}) ;
    },

    setValue: function({el, type, elInput, value /*label, type, schema, table,column, el, elLabel, elInput, value*/}){
        if(type === "bamz_binary" && elInput){
            applyValue({value, elInput})
        }else{
            this.defaultExtension.setValue({el, type, elInput, value}) ;
        }
    }, 
    customCss: "https://cdn.jsdelivr.net/npm/file-icon-vectors@1.0.0/dist/file-icon-vivid.min.css"
}