import * as THREE from "three";

/** A soft opening around each visible aircraft, evaluated separately for each XR eye. */
export class TrailVisibility {
  readonly aircraft = {
    value: Array.from({ length: 3 }, () => new THREE.Vector4()),
  };

  apply<T extends THREE.Material>(material: T): T {
    material.onBeforeCompile = (shader) => {
      shader.uniforms.trailAircraft = this.aircraft;
      shader.vertexShader = `varying vec3 vTrailViewPosition;\n${shader.vertexShader}`;
      shader.vertexShader = shader.vertexShader.replace(
        "#include <project_vertex>",
        "#include <project_vertex>\nvTrailViewPosition = mvPosition.xyz;",
      );
      shader.fragmentShader = `
        varying vec3 vTrailViewPosition;
        uniform vec4 trailAircraft[3];
        ${shader.fragmentShader}`;
      shader.fragmentShader = shader.fragmentShader.replace(
        "#include <opaque_fragment>",
        `
        vec3 trailRay = normalize(vTrailViewPosition);
        float clearance = 1.0;
        for (int i = 0; i < 3; i++) {
          vec4 aircraft = trailAircraft[i];
          if (aircraft.w <= 0.0) continue;
          vec3 centre = (viewMatrix * vec4(aircraft.xyz, 1.0)).xyz;
          float along = dot(centre, trailRay);
          if (centre.z >= 0.0 || along <= 0.0) continue;
          float separation = length(centre - trailRay * along);
          clearance = min(clearance, smoothstep(aircraft.w, aircraft.w * 1.5, separation));
        }
        diffuseColor.a *= clearance;
        #include <opaque_fragment>
        `,
      );
    };
    material.customProgramCacheKey = () => "sound-trail-aircraft-clearance-v1";
    return material;
  }
}
