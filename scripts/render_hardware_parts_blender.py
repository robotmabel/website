"""Studio renders of the exact visual meshes; run through render_hardware_parts.py."""
from pathlib import Path
import json,math,sys
import bpy,bmesh,numpy as np
from mathutils import Vector
args=sys.argv[sys.argv.index('--')+1:];cache=Path(args[0]);out=Path(args[1]);board=Path(args[2]);only=args[3] if len(args)>3 else None;out.mkdir(parents=True,exist_ok=True)
G=np.load(cache.with_suffix('.npz'));meta=json.loads(cache.with_suffix('.json').read_text())
bpy.ops.object.select_all(action='SELECT');bpy.ops.object.delete(use_global=False)
scene=bpy.context.scene;scene.render.engine='CYCLES';scene.cycles.samples=64;scene.cycles.use_denoising=True;scene.render.threads_mode='FIXED';scene.render.threads=8
scene.render.resolution_x=1440;scene.render.resolution_y=1080;scene.render.resolution_percentage=100;scene.render.film_transparent=True
scene.render.image_settings.file_format='PNG';scene.render.image_settings.color_mode='RGBA';scene.world.use_nodes=True;scene.world.node_tree.nodes['Background'].inputs[0].default_value=(.8,.86,1,1);scene.world.node_tree.nodes['Background'].inputs[1].default_value=.4
scene.view_settings.view_transform='Filmic';scene.view_settings.look='Medium High Contrast';scene.view_settings.exposure=.3
materials={}
def material(rgba):
 key=tuple(round(c,3) for c in rgba[:3])
 if key in materials:return materials[key]
 m=bpy.data.materials.new('CAD '+str(key));m.use_nodes=True;p=m.node_tree.nodes.get('Principled BSDF');p.inputs['Base Color'].default_value=(*key,1);p.inputs['Roughness'].default_value=.28;p.inputs['Metallic'].default_value=.3 if max(key)<.3 else .08;materials[key]=m;return m
objects=[]
for row in meta:
 i=row['id'];mesh=bpy.data.meshes.new(row['mesh']);mesh.from_pydata(G[f'v{i}'].tolist(),[],G[f'f{i}'].tolist());mesh.update();mesh.materials.append(material(row['rgba']))
 bm=bmesh.new();bm.from_mesh(mesh);bmesh.ops.remove_doubles(bm,verts=list(bm.verts),dist=1e-7);bmesh.ops.recalc_face_normals(bm,faces=list(bm.faces));bm.to_mesh(mesh);bm.free();mesh.use_auto_smooth=True;mesh.auto_smooth_angle=math.radians(28)
 for p in mesh.polygons:p.use_smooth=True
 ob=bpy.data.objects.new(row['body']+' '+row['mesh'],mesh);bpy.context.collection.objects.link(ob);objects.append((row['body'],ob))
camdata=bpy.data.cameras.new('Camera');cam=bpy.data.objects.new('Camera',camdata);bpy.context.collection.objects.link(cam);scene.camera=cam;camdata.type='ORTHO'
lights=[]
for name,loc,energy,size in [('Key',(-3,-4,5),650,4),('Fill',(-2,4,2),450,3),('Rim',(3,1,4),800,3)]:
 data=bpy.data.lights.new(name,'AREA');data.energy=energy;data.shape='DISK';data.size=size;ob=bpy.data.objects.new(name,data);bpy.context.collection.objects.link(ob);lights.append((ob,Vector(loc)))
shots={
 'base':(lambda b:b=='mabel_chassis' or b.startswith(('fl_','fr_','b_')),(-3,-4,2.5)),
 'lift':(lambda b:b in ['lift_base','lift_mid','lift_top'],(-3,-4,1.5)),
 'body':(lambda b:b in ['body_mount','torso','head_mount'],(-4,-3,2)),
 'arms':(lambda b:b.startswith('r_') and 'hand' not in b,(-4,-3,1.7)),
 'hands':(lambda b:b.startswith('right_') or b=='r_hand_mount',(-4,-3,1.8)),
 'head':(lambda b:b in ['head_mount','neck_1','neck_2','head'],(-3,-4,1.1)),
 'sensors':(lambda b:b=='head',(-4,1.5,.8)),
}
def render(name,obs,direction):
 for _,ob in objects:ob.hide_render=ob not in obs
 bpy.context.view_layer.update();points=[ob.matrix_world@Vector(v) for ob in obs for v in ob.bound_box];lo=Vector(tuple(min(p[i] for p in points) for i in range(3)));hi=Vector(tuple(max(p[i] for p in points) for i in range(3)));center=(lo+hi)/2;extent=max(hi-lo)
 cam.location=center+Vector(direction).normalized()*extent*4;cam.rotation_euler=(center-cam.location).to_track_quat('-Z','Y').to_euler();rot=cam.rotation_euler.to_matrix().transposed();cp=[rot@(p-center) for p in points];width=max(p.x for p in cp)-min(p.x for p in cp);height=max(p.y for p in cp)-min(p.y for p in cp);camdata.ortho_scale=max(width,height*4/3)*1.25;camdata.clip_start=max(.0001,extent*.001);camdata.clip_end=extent*30
 for light,loc in lights:light.location=center+loc*extent;light.data.size=extent*2.5;light.data.energy=650*extent**2;light.rotation_euler=(center-light.location).to_track_quat('-Z','Y').to_euler()
 scene.render.filepath=str(out/(name+'.png'));bpy.ops.render.render(write_still=True);print('RENDERED',name,flush=True)
for name,(choose,view) in shots.items():
 if not only or name==only:render(name,[ob for body,ob in objects if choose(body)],view)
# The production motherboard CAD is used for Electronics, rather than a chassis crop.
if not only or only=='electronics':
 for _,ob in objects:ob.hide_render=True
 bpy.ops.import_scene.gltf(filepath=str(board));boards=[o for o in bpy.context.selected_objects if o.type=='MESH'];render('electronics',boards,(1,-1.3,2.5))
