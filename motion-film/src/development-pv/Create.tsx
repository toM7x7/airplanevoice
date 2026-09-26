import {Video} from '@remotion/media';
import {staticFile} from 'remotion';
import {Frame,Label,Reveal} from './Frame';
export const Create=()=> <Frame>
 <Label>01 / MAKE YOUR AIRCRAFT</Label>
 <div style={{position:'absolute',left:72,top:105}}><Reveal><div style={{fontSize:78,fontWeight:700}}>形と音を選び、名前をつける。</div></Reveal></div>
 <div style={{position:'absolute',left:72,top:240,width:1320,height:742,overflow:'hidden',borderRadius:20,boxShadow:'0 20px 65px #12383b22'}}><Video src={staticFile('development-pv/pc-creation.mp4')} style={{width:1320,height:742}} volume={1}/></div>
 <div style={{position:'absolute',left:1450,top:320,fontSize:48,lineHeight:2.2}}>形を選ぶ<br/>響きを試す<br/>名前を残す</div>
 <div style={{position:'absolute',left:1450,top:750,fontSize:29,lineHeight:1.6,color:'#58706e'}}>PC実画面の操作<br/>音色の違いは改善中</div>
 </Frame>;
