#!/usr/bin/env python3
"""Render isolated subsystem portraits from the robot's exact CAD meshes.

Requires numpy, mujoco, Blender and the source robot checkout. Physics is used
only to settle a display pose in zero gravity; no robot connection is opened.
"""
import argparse,hashlib,json,os,subprocess,sys,tempfile
from pathlib import Path
import numpy as np
import mujoco
from PIL import Image

def main():
    ap=argparse.ArgumentParser(description=__doc__)
    ap.add_argument('--robot-root',type=Path,required=True)
    ap.add_argument('--blender',default='/Applications/Blender.app/Contents/MacOS/Blender')
    ap.add_argument('--output',type=Path,default=Path(__file__).resolve().parents[1]/'assets/hw')
    args=ap.parse_args();root=args.robot_root.resolve();out=args.output.resolve()
    modelpath=root/'simulation/mabel_mujoco/models/mabel_full.xml';board=root/'electrical/exports/Motherboard_real.glb'
    if not modelpath.is_file() or not board.is_file():ap.error('The source robot model and production motherboard GLB are required')
    sys.path.insert(0,str(root/'simulation/mabel_mujoco/scripts/tools'));import render_task_clips as H
    m=mujoco.MjModel.from_xml_path(str(modelpath));m.opt.gravity[:]=0;H.hide_markers(m);d=mujoco.MjData(m)
    for _ in range(900):
        H.ready_pose(m,d);H.set_hands(m,d,.12);H.set_ctrl(m,d,'Lift',.4,1);mujoco.mj_step(m,d)
    mujoco.mj_forward(m,d);meshes=[];arrays={}
    for i in range(m.ngeom):
        if m.geom_group[i]!=2 or m.geom_rgba[i,3]<.1 or m.geom_dataid[i]<0:continue
        mid=int(m.geom_dataid[i]);body=m.body(int(m.geom_bodyid[i])).name
        a,n=int(m.mesh_vertadr[mid]),int(m.mesh_vertnum[mid]);fa,fn=int(m.mesh_faceadr[mid]),int(m.mesh_facenum[mid])
        arrays[f'v{i}']=m.mesh_vert[a:a+n]@d.geom_xmat[i].reshape(3,3).T+d.geom_xpos[i]
        arrays[f'f{i}']=m.mesh_face[fa:fa+fn]
        rgba=m.mat_rgba[int(m.geom_matid[i])] if m.geom_matid[i]>=0 else m.geom_rgba[i]
        meshes.append({'id':i,'body':body,'mesh':m.mesh(mid).name,'rgba':rgba.tolist()})
    # Present the isolated arm extended so its links do not hide one another.
    # The other portraits retain their own settled display pose.
    d.qpos[m.joint('Right Arm 4').qposadr[0]]=-1.1;mujoco.mj_forward(m,d)
    for row in meshes:
        if row['body'].startswith('r_') and 'hand' not in row['body']:
            i=row['id'];mid=int(m.geom_dataid[i]);a,n=int(m.mesh_vertadr[mid]),int(m.mesh_vertnum[mid])
            arrays[f'v{i}']=m.mesh_vert[a:a+n]@d.geom_xmat[i].reshape(3,3).T+d.geom_xpos[i]
    with tempfile.TemporaryDirectory(prefix='mabel-hardware-render-') as folder:
        cache=Path(folder)/'geometry';np.savez_compressed(cache.with_suffix('.npz'),**arrays);cache.with_suffix('.json').write_text(json.dumps(meshes))
        env=dict(os.environ,OPENBLAS_NUM_THREADS='1',VECLIB_MAXIMUM_THREADS='1',OMP_NUM_THREADS='1')
        subprocess.run([args.blender,'-b','--python',str(Path(__file__).with_name('render_hardware_parts_blender.py')),'--',str(cache),str(out),str(board)],check=True,env=env)
    manifest={'method':'Blender Cycles studio lighting; isolated exact visual meshes; orthographic cameras fitted to all subject bounds. No generated hardware geometry.','model_sha256':hashlib.sha256(modelpath.read_bytes()).hexdigest(),'motherboard_sha256':hashlib.sha256(board.read_bytes()).hexdigest(),'visual_meshes':len(meshes),'resolution':[1440,1080],'subsystems':['base','lift','body','arms','hands','head','sensors','electronics']}
    manifest['arm_display_elbow_radians']=-1.1
    for name in manifest['subsystems']:
        image=Image.open(out/(name+'.png'));image.save(out/(name+'.webp'),quality=92,method=6)
        image.resize((720,540),Image.Resampling.LANCZOS).save(out/(name+'-sm.png'))
    (out/'render-provenance.json').write_text(json.dumps(manifest,indent=2)+'\n')
if __name__=='__main__':main()
