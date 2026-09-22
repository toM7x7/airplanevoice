import {Composition,Sequence,staticFile} from 'remotion';
import {Audio} from '@remotion/media';
import {TransitionSeries} from '@remotion/transitions';
import {Hero} from './Hero';
import {Create} from './Create';
import {Assistant} from './Assistant';
import {Scenery} from './Scenery';
import {Radar} from './Radar';
import {Quest} from './Quest';
import {Closing} from './Closing';
const shots=[Hero,Create,Assistant,Scenery,Radar,Quest,Closing];
export const ExhibitionPV=({short=false}:{short?:boolean})=>{const lengths=short?[120,120,150,120,120,150,120]:[300,270,180,210,180,300,360];return <>
 <TransitionSeries>{shots.map((Shot,i)=><TransitionSeries.Sequence key={i} durationInFrames={lengths[i]} name={['原点','機体づくり','AI支援','景色','共有と音','Quest','体験へ'][i]}><Shot/></TransitionSeries.Sequence>)}</TransitionSeries>
 <Audio src={staticFile('exhibition-20260923/flight.mp4')} volume={0.78}/>
 {!short&&<Sequence from={900}><Audio src={staticFile('exhibition-20260923/flight.mp4')} volume={0.78}/></Sequence>}
 </>};
export const ExhibitionCompositions=()=> <>
 <Composition id="Exhibition-PV-60" component={ExhibitionPV} durationInFrames={1800} fps={30} width={1920} height={1080}/>
 <Composition id="Exhibition-PV-30" component={ExhibitionPV} defaultProps={{short:true}} durationInFrames={900} fps={30} width={1920} height={1080}/>
 </>;
