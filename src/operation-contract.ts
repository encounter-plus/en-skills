import type {AuthoringApiPort,AuthoringCapability} from './authoring-api.ts';
export type ToolDefinition = {type:'function';function:{name:string;description:string;parameters:Record<string,unknown>}};
export type LegacyOperationArgs=Record<string,unknown>&{levelId:number};
export interface LegacyOperationSpec {
 definition:ToolDefinition;
 /** Omitted for existing native-only recipes. Shared specs opt in explicitly. */
 engines?:readonly ('legacy'|'modern')[];
 capability:AuthoringCapability|((args:LegacyOperationArgs)=>AuthoringCapability);
 validate(input:Record<string,unknown>):LegacyOperationArgs;
 checkBefore?(before:Record<string,unknown>,args:LegacyOperationArgs):void;
 read(api:AuthoringApiPort,args:LegacyOperationArgs,signal?:AbortSignal):Promise<Record<string,unknown>>;
 request(api:AuthoringApiPort,args:LegacyOperationArgs,before:Record<string,unknown>,journal?:{loadJournal():unknown;saveJournal(value:unknown):Promise<void>}):Promise<Response>;
 verify(before:Record<string,unknown>,after:Record<string,unknown>,args:LegacyOperationArgs,receipt?:Record<string,unknown>):boolean;
 riskReason?:string;
}
