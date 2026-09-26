import {Brand,Film,Frame,Reveal} from './Frame';
export const Quest=()=> <Frame><Brand label="05 / QUEST 3 実機"/>
 <div style={{position:'absolute',left:85,top:220,width:880}}><Reveal><div style={{fontSize:99,fontWeight:700,lineHeight:1.45}}>その空に、<br/>立ってみる。</div></Reveal><div style={{fontSize:40,lineHeight:1.9,marginTop:45}}>VRでは、手元でつくり、見上げる。<br/>ARでは、現実の空間に機体を。</div><div style={{fontSize:25,lineHeight:1.8,marginTop:60,color:'#b9ceca'}}>右：Quest 3のVR実機映像<br/>2026.09.22収録・操作UIは旧版です。<br/>音声はPC版の収録音を使用しています。</div></div>
 <div style={{position:'absolute',left:1030,top:115,width:810,height:900,borderRadius:25,overflow:'hidden'}}><Film name="quest"/></div></Frame>;
