import {buildQuestionRubric} from './question-rubric.mjs';

const int = value => ({op: 'integer', value});
const point = (x, y, z) => [int(x), int(y), int(z)];

const EXAMPLES = [
  {id:'g10-vector-dot',unit:'平面向量及其应用',title:'向量数量积判断垂直',question:'已知 $\\vec a=(1,2)$，$\\vec b=(2,-1)$。判断 $\\vec a$ 与 $\\vec b$ 是否垂直，并说明理由。',answer:'$\\vec a\\cdot\\vec b=1\\times2+2\\times(-1)=0$，所以 $\\vec a\\perp\\vec b$。',steps:['写出坐标数量积公式','计算两个分量乘积之和','由数量积为 0 判定两非零向量垂直'],skill:'用数量积判定向量垂直',rubricId:'grade10_vector_dot'},
  {id:'g10-vector-basis',unit:'平面向量及其应用',title:'平面向量基本定理',question:'在 $\\triangle ABC$ 中，$D$ 是 $BC$ 的中点。用 $\\vec{AB}$、$\\vec{AC}$ 表示 $\\vec{AD}$。',answer:'$\\vec{AD}=\\frac12(\\vec{AB}+\\vec{AC})$。',steps:['由中点关系写出向量关系','用首尾相接表示 AD','换成指定基底并化简'],skill:'用基底表示平面向量',rubricId:'generic_math'},
  {id:'g10-complex-operation',unit:'复数',title:'复数的四则运算',question:'计算 $z=\\frac{1+i}{1-i}$，并写出 $z$ 的代数形式。',answer:'分子、分母同乘 $1+i$，得到 $z=i$。',steps:['选择分母的共轭复数','完成分子分母同乘','利用 $i^2=-1$ 化简'],skill:'用共轭复数化简除法',rubricId:'generic_math'},
  {id:'g10-complex-modulus',unit:'复数',title:'复数的几何意义与模',question:'已知 $z=3-4i$，求 $|z|$，并说明它在复平面上对应点到原点的距离。',answer:'$|z|=\\sqrt{3^2+(-4)^2}=5$，对应点到原点的距离为 5。',steps:['确定复平面对应点','建立模长公式','计算并解释几何意义'],skill:'从复平面理解复数的模',rubricId:'grade10_complex_modulus'},
  {id:'g10-solid-prism-volume',unit:'空间几何',title:'直棱柱的体积',question:'一个直三棱柱的底面三角形面积为 $12\\,\\text{cm}^2$，高为 $5\\,\\text{cm}$，求它的体积。',answer:'$V=S_{\\text{底}}h=12\\times5=60\\,\\text{cm}^3$。',steps:['辨认棱柱底面积和高','选择 $V=Sh$','代入计算并写体积单位'],skill:'识别棱柱的底面积与高',rubricId:'grade10_prism_volume',geometry:'representative_prism'},
  {id:'g10-statistics',unit:'统计',title:'用数据特征描述一组数据',question:'数据 $2,3,3,5,7$ 的平均数和中位数分别是多少？',answer:'平均数为 $4$，中位数为 $3$。',steps:['确认排序和样本量','计算平均数','定位中位数'],skill:'区分平均数与中位数',rubricId:'grade10_statistics'},
  {id:'g10-probability',unit:'概率',title:'不放回抽取的古典概型',question:'一个盒子中有 2 个红球、3 个蓝球，随机不放回抽取 2 个球。求恰好抽到 1 个红球和 1 个蓝球的概率。',answer:'$P=\\frac25\\times\\frac34+\\frac35\\times\\frac24=\\frac35$。',steps:['拆成红后蓝、蓝后红','分别计算不放回概率','将互斥情况相加'],skill:'按顺序拆分不放回概率',rubricId:'grade10_probability'},
  {id:'g10-vector-choice-single',unit:'平面向量及其应用',title:'向量关系单项选择',question:'单项选择题：已知非零向量 $\\vec a,\\vec b$ 满足 $\\vec a\\cdot\\vec b=0$，下列结论正确的是：\nA. $\\vec a\\parallel\\vec b$\nB. $\\vec a\\perp\\vec b$\nC. $|\\vec a|=|\\vec b|$\nD. $\\vec a=\\vec b$',answer:'B。数量积为 0 的两个非零向量互相垂直。',steps:['逐项判断 A','逐项判断 B','逐项判断 C','逐项判断 D','汇总唯一正确选项'],skill:'用数量积判断向量关系',rubricId:'choice_question',correctChoices:['B']},
  {id:'g10-cylinder-choice-multiple',unit:'空间几何',title:'圆柱性质多项选择',question:'多项选择题：一个底面半径为 $3$、高为 $4$ 的直圆柱，下列结论正确的是：\nA. 轴截面面积为 $24$\nB. 体积为 $36\\pi$\nC. 侧面积为 $12\\pi$\nD. 与底面平行的截面是半径为 $3$ 的圆',answer:'A、B、D。轴截面为 $6\\times4$ 的矩形，体积为 $\\pi r^2h=36\\pi$，侧面积为 $2\\pi rh=24\\pi$。',steps:['逐项验证轴截面','逐项验证体积','逐项验证侧面积','逐项验证平行截面','汇总全部正确选项'],skill:'综合判断圆柱的截面、表面积和体积',rubricId:'choice_question',correctChoices:['A','B','D'],geometry:'cylinder'}
];

function prismGeometry() {
  const coordinates = {A:point(0,0,0),B:point(6,0,0),C:point(0,4,0),A1:point(0,0,5),B1:point(6,0,5),C1:point(0,4,5)};
  const edges = [['A','B'],['B','C'],['C','A'],['A1','B1'],['B1','C1'],['C1','A1'],['A','A1'],['B','B1'],['C','C1']];
  return {
    solverStatus:'verified', modelKind:'triangular_prism', canonicalCoordinates:coordinates,
    answer:{latex:'60\\,\\mathrm{cm}^3',displayPlain:'60 cm³'},
    verification:{answerUnique:true,embeddingUnique:false,checks:['底面积 12','棱柱高 5','V=Sh=60']},
    modelNote:'题目只给出底面积，底面三角形形状不唯一；这里展示满足底面积 12、高 5 的一种等价直三棱柱，体积答案唯一。',
    scene:{
      grid:{unit:1,size:8,divisions:8,valueSource:'canonicalCoordinates'}, frameEdges:edges, queryLine:['A','A1'],
      dimensions:[{id:'height',points:['A','A1'],label:'高 5 cm',valueSource:'question.height'}],
      elements:[
        ...edges.map((points,index)=>({id:`edge-${index+1}`,type:'segment',points,style:index>=6?'emphasis':'frame'})),
        {id:'base-face',type:'section-triangle',points:['A','B','C'],opacity:.18},
        {id:'top-face',type:'section-triangle',points:['A1','B1','C1'],opacity:.12},
        {id:'axes',type:'axes',size:3}
      ]
    }
  };
}

function cylinderGeometry() {
  return {
    solverStatus:'verified',modelKind:'cylinder',canonicalCoordinates:{O:point(0,0,0),O1:point(0,0,4),R:point(3,0,0),R1:point(3,0,4)},
    answer:{latex:'A,B,D',displayPlain:'A、B、D'},verification:{answerUnique:true,embeddingUnique:true,checks:['r=3','h=4','轴截面 6×4','V=36π','侧面积=24π']},
    scene:{grid:{unit:1,size:8,divisions:8,valueSource:'canonicalCoordinates'},frameEdges:[['O','O1'],['O','R'],['O1','R1'],['R','R1']],queryLine:['O','O1'],dimensions:[{id:'radius',points:['O','R'],label:'r=3',valueSource:'question.radius'},{id:'height',points:['O','O1'],label:'h=4',valueSource:'question.height'}],elements:[{id:'body',type:'cylinder',baseCenter:'O',topCenter:'O1',radius:int(3),opacity:.35},{id:'axis',type:'segment',points:['O','O1'],style:'emphasis'},{id:'radius',type:'segment',points:['O','R'],style:'frame'},{id:'top-radius',type:'segment',points:['O1','R1'],style:'frame'},{id:'generator',type:'segment',points:['R','R1'],style:'frame'},{id:'axes',type:'axes',size:3}]}
  };
}

function verifiedGeometry(result, example) {
  if (!result) return null;
  const exact = node => node?.op === 'integer' ? node.value : node?.op === 'rational' ? node.p / node.q : NaN;
  const coordinates = Object.fromEntries(Object.entries(result.canonicalCoordinates || {}).map(([name,value])=>[name,value.map(exact)]));
  const validPoint = name => Array.isArray(coordinates[name]) && coordinates[name].length === 3 && coordinates[name].every(Number.isFinite);
  if (!Object.keys(coordinates).length || !Object.keys(coordinates).every(validPoint)) throw new Error(`EXAMPLE_GEOMETRY_COORDINATES_INVALID:${example.id}`);
  if (!result.scene?.grid || result.scene.grid.divisions * result.scene.grid.unit !== result.scene.grid.size) throw new Error(`EXAMPLE_GEOMETRY_GRID_INVALID:${example.id}`);
  if (!result.scene.frameEdges?.length || result.scene.frameEdges.some(edge=>!Array.isArray(edge)||edge.length!==2||edge.some(name=>!validPoint(name)))) throw new Error(`EXAMPLE_GEOMETRY_EDGE_INVALID:${example.id}`);
  if (!result.scene.dimensions?.length || result.scene.dimensions.some(item=>item.points?.some(name=>!validPoint(name)))) throw new Error(`EXAMPLE_GEOMETRY_DIMENSION_INVALID:${example.id}`);
  if (!result.scene.elements?.length) throw new Error(`EXAMPLE_GEOMETRY_SCENE_EMPTY:${example.id}`);
  if (example.geometry === 'representative_prism') {
    const [a,b,c,a1]=['A','B','C','A1'].map(name=>coordinates[name]);
    const ab=b.map((value,index)=>value-a[index]),ac=c.map((value,index)=>value-a[index]);
    const cross=[ab[1]*ac[2]-ab[2]*ac[1],ab[2]*ac[0]-ab[0]*ac[2],ab[0]*ac[1]-ab[1]*ac[0]];
    const baseArea=Math.hypot(...cross)/2,height=Math.hypot(...a1.map((value,index)=>value-a[index]));
    if (baseArea!==12||height!==5||baseArea*height!==60) throw new Error(`EXAMPLE_PRISM_CONSTRAINT_FAILED:${example.id}`);
  }
  if (example.geometry === 'cylinder') {
    const radius=Math.hypot(...coordinates.R.map((value,index)=>value-coordinates.O[index])),height=Math.hypot(...coordinates.O1.map((value,index)=>value-coordinates.O[index]));
    if (radius!==3||height!==4||Math.PI*radius*radius*height!==36*Math.PI) throw new Error(`EXAMPLE_CYLINDER_CONSTRAINT_FAILED:${example.id}`);
  }
  return {...result,solverStatus:'verified',verification:{...result.verification,validatedAtRuntime:true}};
}

const geometryFor = example => verifiedGeometry(example.geometry === 'representative_prism' ? prismGeometry() : example.geometry === 'cylinder' ? cylinderGeometry() : null, example);

export function grade10ExampleCatalog() {
  return EXAMPLES.map(example => {
    const {answer,correctChoices,geometry,...publicExample}=example;
    return {...publicExample,questionKind:buildQuestionRubric(example.question).questionKind,geometryAvailable:Boolean(geometry)};
  });
}

export function createGrade10ExampleCase(exampleId, {id, createdAt} = {}) {
  const example = EXAMPLES.find(item => item.id === exampleId);
  if (!example) return null;
  const choice = buildQuestionRubric(example.question);
  const scoringRubric = choice.parts.length ? choice.parts : example.steps.map((title,index)=>({id:`part_${index+1}`,label:title,title,hint:`完成：${title}`,steps:[`part_${index+1}`]}));
  const geometryResult = geometryFor(example);
  return {
    id,subject:'数学',unit:example.unit,title:example.title,question:example.question,studentAnswer:'待开始真实作答',
    correctAnswer:example.answer,correctAnswerLatex:example.answer,analysis:`配置例题经后台复核后模拟真实上传：${example.steps.join('；')}。`,
    knowledgePoints:[example.unit],microSkills:[example.skill],errorCauses:[],questionType:choice.questionKind==='single_choice'?'单项选择题':choice.questionKind==='multiple_choice'?'多项选择题':'解答题',
    origin:'configured_example_upload',configuredExampleId:example.id,excludeFromLearningAnalytics:false,verificationStatus:'verified',createdAt,confirmedAt:createdAt,
    uploadTrace:{source:'configured_example',textExtraction:'passed',internalReview:'passed',confirmedAutomatically:true},
    problemSpec:{schema:'configured-example/v1',source:'simulated_real_upload',tutorRubricId:example.rubricId,questionKind:choice.questionKind,choiceOptions:choice.options,choiceAnswer:example.correctChoices||[],scoringRubric,standardSolutionSteps:example.steps},
    learningProfile:{mastery:0,confidence:0,bottleneck:example.skill,interval:0,dueAt:String(createdAt||'').slice(0,10),reviews:0,lastResult:'尚未完成本题'},
    ...(geometryResult?{geometryResult,visualization:{renderer:'three',interactive:true,scene:geometryResult.scene}}:{})
  };
}
