import React from 'react';
import {createRoot} from 'react-dom/client';
import {Canvas} from '@react-three/fiber';
import {Aircraft} from '../apps/desktop/src/Aircraft';
export function renderPlane(){
 document.body.innerHTML='<div id="capture"></div>';
 document.body.style.margin='0';
 createRoot(document.getElementById('capture')!).render(<Canvas style={{width:1600,height:1200}} gl={{alpha:true,preserveDrawingBuffer:true,antialias:true}} camera={{position:[65,-42,100],fov:35}}><ambientLight intensity={1.7}/><directionalLight position={[-40,50,80]} intensity={3}/><directionalLight position={[30,-50,30]} intensity={2}/><Aircraft accent="#235967"/></Canvas>);
}
