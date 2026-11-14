// Synthetic, fully specified geometry. No student data or provider configuration.
export const derivedChainIR=()=>({schemaVersion:'geometry-ir/polyhedron-v1',solid:{kind:'cube',edge:2},queries:[
  {id:'midpoint',kind:'point_on_segment',segment:['A','B'],parameter:.5,pointId:'M'},
  {id:'angle',kind:'line_plane_angle',line:['M','C1'],plane:['A','B','D']},
  {id:'dihedral',kind:'dihedral_angle',angleType:'plane_angle',firstPlane:['M','B','B1'],secondPlane:['A','B','D']},
  {id:'distance',kind:'point_plane_distance',point:'M',plane:['B','C','C1']},
  {id:'next-midpoint',kind:'point_on_segment',segment:['M','C1'],parameter:.5,pointId:'N'},
  {id:'foot',kind:'projection_to_plane',point:'N',plane:['A','B','D'],footId:'H'},
  {id:'height-angle',kind:'line_plane_angle',line:['N','H'],plane:['A','B','D']},
  {id:'height',kind:'segment_length',points:['N','H']}
]});
