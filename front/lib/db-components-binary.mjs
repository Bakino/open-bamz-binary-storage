const toBase64 = file => new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.readAsDataURL(file);
    // @ts-ignore
    reader.onload = () => resolve(reader.result.substring(reader.result.indexOf("base64,")+"base64,".length));
    reader.onerror = reject;
});

/**
 * Reduces an image file based on two optional constraints:
 *   - maxWidth: maximum width in pixels (height is scaled proportionally)
 *   - maxSize:  maximum file size in bytes
 *
 * Strategy:
 *   1. If maxWidth is set and the image is wider, scale it down to maxWidth first.
 *   2. If maxSize is set and the result still exceeds it, decrease JPEG quality
 *      in steps from 0.85 down to 0.1.
 *   3. If minimum quality is still not enough, reduce dimensions by 20% and retry
 *      from step 2, until the image is small enough or scale drops below 5%.
 *
 * Always outputs JPEG to allow quality control via canvas.toDataURL.
 *
 * @param {File} file       - the original image file
 * @param {number} maxWidth - maximum width in pixels (0 = no constraint)
 * @param {number} maxSize  - maximum size in bytes (0 = no constraint)
 * @returns {Promise<{ base64: string, mimetype: string }>}
 */
function reduceImage(file, maxWidth, maxSize) {
    return new Promise((resolve, reject) => {
        // Estimate byte size from base64 string length
        const base64ByteSize = (b64) => Math.round(b64.length * 3 / 4);

        const reader = new FileReader();
        reader.onerror = reject;
        reader.onload = (e) => {
            const img = new Image();
            img.onerror = reject;
            img.onload = () => {
                const originalWidth = img.naturalWidth;
                const originalHeight = img.naturalHeight;

                // Compute the initial scale factor from maxWidth constraint
                let scaleFactor = 1;
                if (maxWidth && originalWidth > maxWidth) {
                    scaleFactor = maxWidth / originalWidth;
                    console.log("Resize image from "+originalWidth+" to "+maxWidth+" (ratio "+scaleFactor+")")
                }

                // If no maxSize constraint and no resizing needed, return original base64
                if (!maxSize && scaleFactor === 1) {
                    // @ts-ignore
                    const originalBase64 = e.target.result.substring(
                        // @ts-ignore
                        e.target.result.indexOf("base64,") + "base64,".length
                    );
                    resolve({ base64: originalBase64, mimetype: file.type });
                    return;
                }

                // Always encode as JPEG to allow quality adjustment
                const outputMime = "image/jpeg";
                const canvas = document.createElement("canvas");
                const ctx = canvas.getContext("2d");

                const tryEncode = () => {
                    const newW = Math.round(originalWidth * scaleFactor);
                    const newH = Math.round(originalHeight * scaleFactor);
                    canvas.width = newW;
                    canvas.height = newH;
                    ctx.clearRect(0, 0, newW, newH);
                    ctx.drawImage(img, 0, 0, newW, newH);

                    // If no maxSize constraint, a single encode at full quality is enough
                    if (!maxSize) {
                        const dataUrl = canvas.toDataURL(outputMime, 0.85);
                        const base64 = dataUrl.substring(dataUrl.indexOf("base64,") + "base64,".length);
                        resolve({ base64, mimetype: outputMime });
                        return;
                    }

                    // Decrease quality from 0.85 to 0.1 until under maxSize
                    let quality = 0.85;
                    let dataUrl, base64;
                    do {
                        dataUrl = canvas.toDataURL(outputMime, quality);
                        base64 = dataUrl.substring(dataUrl.indexOf("base64,") + "base64,".length);
                        if (base64ByteSize(base64) <= maxSize) {
                            console.log("Resized to "+maxSize+" using quality compression");
                            resolve({ base64, mimetype: outputMime });
                            return;
                        }
                        quality = Math.round((quality - 0.1) * 10) / 10;
                    } while (quality >= 0.1);

                    // Minimum quality not enough — reduce dimensions by 20% and retry
                    scaleFactor *= 0.8;
                    if (scaleFactor < 0.05) {
                        // Extreme edge case: return best result anyway
                        console.log("Resized to "+maxSize+" using quality compression and size reduce");
                        resolve({ base64, mimetype: outputMime });
                        return;
                    }
                    tryEncode();
                };

                tryEncode();
            };
            // @ts-ignore
            img.src = e.target.result;
        };
        reader.readAsDataURL(file);
    });
}

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
    const elInputField = elInput.querySelector("input") ;
    if(value){
        elIcons.style.display = "flex" ;
        elInput.value = value ;
        elInfos.innerHTML = value.filename+" ("+value.mimetype+")" ;
        elPreview.style.width = "35px";
        elPreview.style.marginRight = "5px";
        elPreview.style.fontSize = "40px";
        if(value.index_id){
            // value from database
            elInputField.value = null; //reset file input
        }
    }else{
        elInputField.value = null; //reset file input
        elInfos.innerHTML = "" ;
        elIcons.style.display = "none" ;  
        elPreview.style.width = "0px";
        elPreview.style.marginRight = "0px";
        elInput.value = null ;
    }
    preview({elPreview, value}) ;
}

export default {
    defaultExtension: null,
    generateInputElement: async function({label, type, schema, table, column, el, placeholder, dbApi}){
        if(type === "bamz_binary"){
            const elBinary = /** @type {HTMLDivElement} */ (document.createElement("DIV")) ;
            elBinary.style.display = "flex" ;
            elBinary.style.flexWrap = "wrap" ;
            elBinary.style.alignItems = "center" ;

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
            // @ts-ignore
            if(window.cordova && window.device && window.device.platform === "Android"){
                //force camera for android
                elInput.capture = "camera" ;
            }
            elInput.type = "file" ;
            elInput.addEventListener("change", async (ev)=>{
                ev.stopPropagation() ;
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

                            let base64;
                            let mimetype = file.type;

                            if(el.hasAttribute("db-reduce-image") && file.type.startsWith("image/")) {
                                const maxSize  = Number(el.getAttribute("db-max-image-size"))  || 0;
                                const maxWidth = Number(el.getAttribute("db-max-image-width")) || 0;
                                const result = await reduceImage(file, maxWidth, maxSize);
                                base64   = result.base64;
                                mimetype = result.mimetype;
                            } else {
                                base64 = await toBase64(file);
                            }

                            // @ts-ignore
                            elBinary.value = {
                                data: base64,
                                filename: file.name,
                                mimetype: mimetype
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

    setReadOnly: function({el, type, elInput, readOnly, /*label, type, schema, table,column, el, elLabel, elInput, value*/}){
        if(type === "bamz_binary" && elInput){
            const inputElm = elInput.querySelector("input[type='file']") ;
            const btReset = elInput.querySelector(".bamz-binary-reset") ;
            if(readOnly){
                inputElm.style.display = "none" ;
                btReset.style.display = "none" ;
            }else{
                inputElm.style.display = "" ;
                btReset.style.display = "" ;
            }
        }else{
            this.defaultExtension.setReadOnly({el, type, elInput, readOnly}) ;
        }
    },


    customCss: "https://cdn.jsdelivr.net/npm/file-icon-vectors@1.0.0/dist/file-icon-vivid.min.css"
}