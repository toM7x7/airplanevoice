import {Video} from '@remotion/media';
import {staticFile} from 'remotion';
import {Frame,Label,Reveal} from './Frame';
export const Quest=()=> <Frame dark>
 <Label dark>04 / QUEST 3 実機収録</Label>
 <div style={{position:'absolute',left:92,top:230,width:770}}><Reveal><div style={{fontSize:102,fontWeight:700,lineHeight:1.4}}>その空に、<br/>立ってみる。</div></Reveal><div style={{fontSize:42,lineHeight:1.8,marginTop:60}}>手元の一機を見ながら、<br/>VRの中で選ぶ。</div><div style={{fontSize:26,lineHeight:1.7,marginTop:74,color:'#aac6c3'}}>実際のユーザー操作を録画<br/>左目の映像を切り出し／このカットは無音</div></div>
 <div style={{position:'absolute',left:1040,top:115,width:810,height:900,overflow:'hidden',borderRadius:28,background:'#000'}}><Video src={staticFile('development-pv/quest-creation.mp4')} style={{width:810,height:900}} muted/></div>
 </Frame>;
