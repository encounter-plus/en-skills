import {validateModernGameFileUpload,readModernGameFiles,checkModernGameFileBefore,modernGameFileUploadRequest,inspectModernGameUploadImage,verifyModernGameFileUpload} from './authoring-browser.ts';
import type {AuthoringApiPort} from './authoring-api.ts';
import type {LegacyOperationSpec} from './operation-contract.ts';

/** resolveImage must verify artifact ownership, selected chat, scope and active binding. */
export function createModernGameFileUploadSpec(resolveImage:(imageRef:string,api:AuthoringApiPort)=>Promise<Blob>):LegacyOperationSpec{
 const upload=(args:Record<string,unknown>)=>validateModernGameFileUpload(Object.fromEntries(Object.entries(args).filter(([key])=>!['imageRef','levelId'].includes(key))));
 return {
  engines:['modern'],capability:'game-file-upload',
  definition:{type:'function',function:{name:'encounter_propose_modern_image_upload',description:'Prepare one reviewed upload of a user-supplied or generated image artifact. Use the opaque imageRef and exact size/sha256 supplied by the host. Files are PNG/JPG/GIF, max 10 MiB and bounded by the game limit. poster:true requires poster.png/jpg/gif and independently verifies game.poster_url after upload. Existing filename requires explicit replaceExisting:true. Multiple poster extensions are rejected. No automatic deletion or uncertain retries. Readback verifies inventory size and poster selection; remote byte hash is not available from this API.',parameters:{type:'object',additionalProperties:false,properties:{imageRef:{type:'string',maxLength:500},filename:{type:'string',pattern:'^[A-Za-z0-9][A-Za-z0-9._-]{0,199}\\.(png|jpg|gif)$'},size:{type:'integer',minimum:1,maximum:10485760},sha256:{type:'string',pattern:'^[a-f0-9]{64}$'},poster:{type:'boolean'},replaceExisting:{type:'boolean'}},required:['imageRef','filename','size','sha256','poster','replaceExisting']}}},
  validate(input){if(Object.keys(input).some(key=>!['imageRef','filename','size','sha256','poster','replaceExisting','levelId'].includes(key))||typeof input.imageRef!=='string'||!input.imageRef||input.imageRef.length>500||input.levelId!==undefined&&input.levelId!==0)throw new Error('Invalid image upload artifact');return {levelId:0,imageRef:input.imageRef,...upload(input)};},
  async read(api,args,signal){await inspectModernGameUploadImage(upload(args),await resolveImage(String(args.imageRef),api));return readModernGameFiles(api,signal);},
  checkBefore:(before,args)=>checkModernGameFileBefore(before,upload(args)),
  async request(api,args,before){return modernGameFileUploadRequest(api,upload(args),before,await resolveImage(String(args.imageRef),api));},
  verify:(before,after,args)=>verifyModernGameFileUpload(before,after,upload(args)),
  riskReason:'Review supplied image hash, filename, size, game and whether an existing file will be replaced. One multipart upload; independent readback verifies inventory metadata and poster_url when requested. The API does not expose a remote byte hash.',
 };
}
