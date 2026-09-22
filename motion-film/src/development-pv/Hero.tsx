import {Video} from '@remotion/media';
import {staticFile,Interactive,interpolate,useCurrentFrame} from 'remotion';
import {Frame,Label,Reveal} from './Frame';
export const Hero=()=>{const frame=useCurrentFrame();return <Frame dark>
 <Video src={staticFile('development-pv/pc-flight.mp4')} objectFit="cover" style={{width:1920,height:1080}} volume={0.8}/>
 <div style={{position:'absolute',inset:0,background:'linear-gradient(90deg,rgba(10,35,43,.82),transparent 85%)'}}/>
 <Label dark>AIRPLANEVOICE / DEVELOPMENT FILM</Label>
 <div style={{position:'absolute',left:96,top:230}}><Reveal><div style={{fontSize:112,fontWeight:700,lineHeight:1.4}}>見上げた空に、<br/>あなたの一機。</div></Reveal><Interactive.Div name="原点" style={{fontSize:43,marginTop:48,opacity:interpolate(frame,[40,65],[0,1],{extrapolateLeft:'clamp',extrapolateRight:'clamp'})}}>飛ぶ姿と、その響きに見惚れる。</Interactive.Div></div>
 <div style={{position:'absolute',left:96,bottom:65,fontSize:25}}>PC版の実映像・アプリ音声 ／ 開発中</div>
 </Frame>};
