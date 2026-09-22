import {Video} from '@remotion/media';
import {staticFile,useCurrentFrame} from 'remotion';
import {Frame,Label,Reveal} from './Frame';
export const Assistant=()=>{const frame=useCurrentFrame();return <Frame>
 <Label>02 / GPT-LIVE ・ 対話と操作のアシスト</Label>
 <div style={{position:'absolute',left:72,top:105}}><Reveal><div style={{fontSize:78,fontWeight:700}}>「こうしたい」を、操作につなぐ。</div></Reveal></div>
 <div style={{position:'absolute',left:72,top:240,width:1320,height:742,overflow:'hidden',borderRadius:20}}><Video src={staticFile('development-pv/pc-creation.mp4')} trimBefore={270} style={{width:1320,height:742}} muted/></div>
 <div style={{position:'absolute',left:1450,top:340,width:395,fontSize:43,fontWeight:700,lineHeight:1.65}}>{frame<110?'「音を重くして」':<>「飛ばす場所を<br/>教えて」</>}</div>
 <div style={{position:'absolute',left:1450,top:565,width:395,fontSize:32,lineHeight:1.8}}>{frame<110?'候補を下書きへ反映。':'押すボタンを強調。'}<br/>最後は、自分で決める。</div>
 <div style={{position:'absolute',left:1450,top:800,width:395,padding:'18px 20px',boxSizing:'border-box',background:'#e5d9bc',borderRadius:12,fontSize:26,lineHeight:1.55}}>AI応答は模擬<br/>実UI・ツール受け口の検証<br/>音声対話は未収録</div>
 </Frame>};
