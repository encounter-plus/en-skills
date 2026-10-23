const MAX_PIXELS = 20_000_000;
/** Inspect raster headers before allocating a decoded bitmap; reject animation, SVG and oversize inputs. */
export function dimensions(bytes:Uint8Array): {width:number;height:number;format:'png'|'jpeg'|'webp'} {
  const v=new DataView(bytes.buffer,bytes.byteOffset,bytes.byteLength);
  const str=(n:number,l:number)=>String.fromCharCode(...bytes.subarray(n,n+l));
  let width=0,height=0,format:'png'|'jpeg'|'webp';
  if(bytes[0]===137&&str(1,3)==='PNG') {
    format='png';width=v.getUint32(16);height=v.getUint32(20);
    for(let p=8;p+12<=bytes.length;) {const len=v.getUint32(p),tag=str(p+4,4);if(tag==='acTL')throw Error('Animated images are not supported');if(p+12+len>bytes.length)throw Error('Invalid PNG');p+=12+len;}
  } else if(bytes[0]===255&&bytes[1]===216) {
    format='jpeg';let p=2;
    while(p+3<bytes.length){if(bytes[p++]!==255)throw Error('Invalid JPEG');while(bytes[p]===255)p++;const tag=bytes[p++];if(tag===217||tag===218)break;if(tag===1||(tag>=208&&tag<=215))continue;const len=v.getUint16(p);if(len<2||p+len>bytes.length)throw Error('Invalid JPEG');if([192,193,194,195,197,198,199,201,202,203,205,206,207].includes(tag)){height=v.getUint16(p+3);width=v.getUint16(p+5);break;}p+=len;}
  } else if(str(0,4)==='RIFF'&&str(8,4)==='WEBP') {
    format='webp';
    const u24=(p:number)=>bytes[p]+bytes[p+1]*256+bytes[p+2]*65536;
    for(let p=12;p+8<=bytes.length;) {const tag=str(p,4),len=v.getUint32(p+4,true),d=p+8;if(d+len>bytes.length)throw Error('Invalid WebP');
      if(tag==='ANIM'||tag==='ANMF'||(tag==='VP8X'&&(bytes[d]&2)))throw Error('Animated images are not supported');
      if(tag==='VP8X'){width=u24(d+4)+1;height=u24(d+7)+1;}
      if(tag==='VP8 '&&!width){width=v.getUint16(d+6,true)&16383;height=v.getUint16(d+8,true)&16383;}
      if(tag==='VP8L'&&!width){const bits=v.getUint32(d+1,true);width=(bits&16383)+1;height=((bits>>>14)&16383)+1;}
      p=d+len+(len%2);
    }
  } else throw Error('Only static PNG, JPEG and WebP are supported');
  if(!width||!height||width*height>MAX_PIXELS||width>16384||height>16384)throw Error('Image exceeds safe browser dimensions');
  return {width,height,format};
}
