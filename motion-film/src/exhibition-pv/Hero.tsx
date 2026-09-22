import {Brand,Film,Frame,Reveal} from './Frame';
export const Hero=()=> <Frame>
 <Film name="flight" style={{objectFit:'cover'}}/>
 <div style={{position:'absolute',inset:0,background:'linear-gradient(90deg,#102e35dd,transparent 92%)'}}/>
 <Brand label="VR・AR / EXHIBITION DEMO"/>
 <div style={{position:'absolute',left:86,top:210}}><Reveal><div style={{fontSize:100,fontWeight:700,lineHeight:1.45}}>空を見上げ、<br/>音の軌跡をたどる。</div></Reveal><div style={{fontSize:39,marginTop:50,lineHeight:1.8}}>飛ぶ姿を目で追い、<br/>遅れて届く音に耳を澄ませます。</div></div>
 <div style={{position:'absolute',left:86,bottom:56,fontSize:24,color:'#dfebe5'}}>PC版の実映像・収録音を編集 ／ ヘッドホン推奨</div>
 </Frame>;
