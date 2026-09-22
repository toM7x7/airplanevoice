import {Brand,Film,Frame,Reveal} from './Frame';
export const Closing=()=> <Frame><Film name="flight" start={18*30} style={{objectFit:'cover'}}/><div style={{position:'absolute',inset:0,background:'linear-gradient(90deg,#102e35ec, #102e3570)'}}/><Brand label="DEVELOPMENT FILM / 2026.09.23"/>
 <div style={{position:'absolute',left:88,top:225}}><Reveal><div style={{fontSize:100,fontWeight:700,lineHeight:1.4}}>見上げた空に、<br/>あなたの一機。</div></Reveal><div style={{fontSize:37,marginTop:50,lineHeight:1.9}}>つくる。飛ばす。音に見惚れる。<br/>PC・Quest 3で楽しむ、旅客機のVR・AR体験です。</div></div>
 <div style={{position:'absolute',left:88,bottom:66}}><div style={{fontSize:44,fontWeight:700}}>airplanevoice.pages.dev</div><div style={{fontSize:25,color:'#c6d7d1',marginTop:21}}>Codexと制作する、3D・音響・AI連携の実験。</div></div></Frame>;
