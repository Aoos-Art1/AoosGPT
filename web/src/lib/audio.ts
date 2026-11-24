/** Converts a user-initiated recording into bounded 16 kHz mono PCM WAV. */
export async function recordingToWav(recording:Blob):Promise<File> {
  if (recording.size > 10_000_000) throw new Error("التسجيل كبير جدًا. سجّل مقطعًا أقصر.");
  const audioContext=new AudioContext();
  try {
    const decoded=await audioContext.decodeAudioData(await recording.arrayBuffer());
    if (!Number.isFinite(decoded.duration) || decoded.duration <= 0 || decoded.duration > 60.5) {
      throw new Error("يجب ألا يتجاوز التسجيل ٦٠ ثانية.");
    }
    const length=Math.min(60*16000,Math.ceil(decoded.duration*16000));
    const offline=new OfflineAudioContext(1,length,16000);
    const source=offline.createBufferSource();
    source.buffer=decoded;
    source.connect(offline.destination);
    source.start();
    const pcm=(await offline.startRendering()).getChannelData(0);
    const bytes=new ArrayBuffer(44+pcm.length*2);
    const view=new DataView(bytes);
    const write=(at:number,value:string)=>Array.from(value).forEach((c,i)=>view.setUint8(at+i,c.charCodeAt(0)));
    write(0,"RIFF");view.setUint32(4,36+pcm.length*2,true);write(8,"WAVE");write(12,"fmt ");
    view.setUint32(16,16,true);view.setUint16(20,1,true);view.setUint16(22,1,true);
    view.setUint32(24,16000,true);view.setUint32(28,32000,true);view.setUint16(32,2,true);view.setUint16(34,16,true);
    write(36,"data");view.setUint32(40,pcm.length*2,true);
    for (let i=0;i<pcm.length;i++) {
      const sample=Math.max(-1,Math.min(1,pcm[i]));
      view.setInt16(44+i*2,sample<0?Math.round(sample*32768):Math.round(sample*32767),true);
    }
    return new File([bytes],"recording.wav",{type:"audio/wav"});
  } finally { await audioContext.close(); }
}
