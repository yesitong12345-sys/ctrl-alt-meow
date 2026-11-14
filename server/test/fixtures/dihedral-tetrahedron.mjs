// Synthetic tetrahedron: the half-planes A-OZ-B form 120 degrees.
export const dihedralTetrahedronIR=()=>({schemaVersion:'geometry-ir/polyhedron-v1',solid:{kind:'polyhedron',
  coordinates:{O:[0,0,0],Z:[0,0,2],A:[1,0,0],B:[-.5,Math.sqrt(3)/2,0]},
  faces:[['O','Z','A'],['O','B','Z'],['O','A','B'],['Z','B','A']]},queries:[{
    id:'angle',kind:'dihedral_angle',angleType:'dihedral',firstPlane:['O','Z','A'],secondPlane:['O','Z','B'],
    edge:['O','Z'],firstSide:'A',secondSide:'B'
  }]});
