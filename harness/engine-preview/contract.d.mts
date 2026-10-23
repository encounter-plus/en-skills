export function parsePreviewUrl(raw:string):{url:string;domain:string;gameId:number;levelNumber:number};
export function parseLegacyPreviewUrl(raw:string):{url:string;domain:string;gameId:number;levelNumber:number;engine:'legacy'};
export function validatePreviewScenario(value:any):any;
export function scenarioHasActions(value:any):boolean;
export function runPreviewScenario(transport:(command:any)=>Promise<any>,scenario:any,options?:{signal?:AbortSignal;allowActions?:boolean}):Promise<any>;
export function runLegacyPreviewScenario(transport:(command:any)=>Promise<any>,scenario:any,options?:{signal?:AbortSignal;allowActions?:boolean}):Promise<any>;
