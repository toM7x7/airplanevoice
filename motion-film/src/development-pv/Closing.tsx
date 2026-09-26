import {Video} from '@remotion/media';
import {staticFile} from 'remotion';
import {Frame,Label,Reveal} from './Frame';
export const Closing=()=> <Frame dark>
 <Video src={staticFile('development-pv/pc-flight.mp4')} trimBefore={90} objectFit="cover" style={{width:1920,height:1080}} volume={0.65}/>
 <div style={{position:'absolute',inset:0,background:'rgba(11,37,44,.7)'}}/>
 <Label dark>NEXT / 制作と観察を、もっと分かりやすく</Label>
 <div style={{position:'absolute',left:96,top:205}}><Reveal><div style={{fontSize:99,fontWeight:700,lineHeight:1.5}}>つくる。聴く。飛ばす。<br/>また、空を見上げたくなる。</div></Reveal></div>
 <div style={{position:'absolute',left:96,top:610,fontSize:43}}>格納庫　 →　 試し聴き　 →　 観察</div>
 <div style={{position:'absolute',left:96,top:700,fontSize:29,color:'#d3e0d9'}}>この画面分離は次の開発。キーボードでの命名・メニュー階層・音の違いを改善へ。</div>
 <div style={{position:'absolute',left:96,bottom:85,fontSize:44,letterSpacing:5}}>AIRPLANEVOICE <span style={{fontSize:25,letterSpacing:1}}>開発中 / 2026.09</span></div>
 </Frame>;
