import {Interactive,interpolate,useCurrentFrame} from 'remotion';
import {Frame,Label,Reveal} from './Frame';
export const Context=()=>{const frame=useCurrentFrame();return <Frame dark>
 <Label dark>03 / TYPESAFE Jev ・ 状況を対話へ活かす設計</Label>
 <div style={{position:'absolute',left:96,top:154}}><Reveal><div style={{fontSize:94,fontWeight:700}}>空の「いま」を、会話の手がかりに。</div></Reveal></div>
 <div style={{position:'absolute',left:96,top:375,width:470,height:320,border:'1px solid #668985',borderRadius:20,padding:36,boxSizing:'border-box'}}><div style={{fontSize:38,color:'#a5c8c4'}}>空間のコンテキスト</div><div style={{fontSize:40,lineHeight:1.8,marginTop:30}}>機体・距離・飛び方<br/>音・見ている方向</div></div>
 <Interactive.Div name="Jev" style={{position:'absolute',left:666,top:375,width:480,height:320,borderRadius:20,background:'#295e61',padding:36,boxSizing:'border-box',opacity:interpolate(frame,[30,55],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'})}}><div style={{fontSize:60,fontWeight:700}}>Jev</div><div style={{fontSize:38,lineHeight:1.6,marginTop:28}}>状況を整理し、<br/>注目する点を拾う</div></Interactive.Div>
 <Interactive.Div name="対話へ" style={{position:'absolute',left:1250,top:375,width:570,height:320,borderRadius:20,background:'#e8dfc7',color:'#153e43',padding:36,boxSizing:'border-box',opacity:interpolate(frame,[65,90],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'})}}><div style={{fontSize:54,fontWeight:700}}>GPT-Liveへ</div><div style={{fontSize:38,lineHeight:1.6,marginTop:28}}>その場に合う案内や、<br/>機体・音づくりの相談へ</div></Interactive.Div>
 <div style={{position:'absolute',left:590,top:485,fontSize:52}}>→</div><div style={{position:'absolute',left:1170,top:485,fontSize:52}}>→</div>
 <div style={{position:'absolute',left:96,top:820,fontSize:33,color:'#c1d4d1'}}>構想・接続拡張中。映像認識や自律管制の完成を示すものではありません。</div>
 </Frame>};
