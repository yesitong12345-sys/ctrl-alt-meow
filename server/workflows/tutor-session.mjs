import {randomUUID} from 'node:crypto';
import {buildQuestionRubric} from './question-rubric.mjs';
import {buildGeometryRubric} from './geometry-rubric.mjs';
import {aiRubricProfile} from './ai-rubric.mjs';

const now = () => new Date().toISOString();
const transition = (session, to) => {
  session.status = to;
  session.transitions.push({to, at: now()});
};

const normalize = value => String(value || '')
  .toLowerCase()
  .replace(/[\s\u3000,，。.!！?？;；:：、·\-—_()（）[\]{}'"“”‘’<>/\\|]/g, '');

/* 模型偶尔会在正文开头自带说话人标签（「人工智能：」「AI：」「老师：」这类）。
   界面上已经有「AI：」这一栏，正文再重复一次纯属噪声，学生也看不出这是谁在说话。
   入库前剥掉一层：只剥开头，两种形态都认——
     ① 带括号的标签（【AI】/「老师」/（助手）），括号本身就是标签标记，冒号可有可无；
     ② 裸标签必须跟冒号（AI：/老师：/人工智能：），否则「系统」这类词开头的正文会被误伤。
   正文中间的冒号一律不动。 */
const SPEAKER_LABEL = /^\s*(?:[【\[「"'（(]\s*(?:人工智能|AI\s*老师|AI\s*助手|AI|助手|系统|老师|机器人)\s*[】\]」"'）)]\s*[：:]?\s*|(?:人工智能|AI\s*老师|AI\s*助手|AI|助手|系统|老师|机器人)\s*[：:]\s*)/;
const stripSpeakerLabel = value => {
  const text = String(value == null ? '' : value);
  const stripped = text.replace(SPEAKER_LABEL, '');
  return stripped.trim() ? stripped : text;
};

const STEP_DEFINITIONS = [
  {
    id: 'frame',
    detect: text => /(建系|建立坐标系|坐标系|原点|底面中心|选轴|坐标轴)/.test(text),
    understanding: '你已经开始把图形关系转成坐标关系，正在建立坐标系。',
    explanation: '这一步的目标不是把整题做完，而是先把空间关系固定到一个可计算的坐标系里。',
    nextQuestion: '坐标系已确定，请用底边和高写出 A、B、C、P 的坐标？'
  },
  {
    id: 'vertices',
    detect: text => (
      /((a|b|c|p|顶点).{0,14}(坐标|位置|表达|列好|写好|写出|确定|算出|得出|已知|搞定))/.test(text) ||
      /((坐标|位置|表达).{0,14}(a|b|c|p|顶点))/.test(text) ||
      /(四个点|四个顶点).{0,14}(确定|列好|写好|写出|有了|搞定|完成)/.test(text)
    ),
    understanding: '你已经把顶点坐标这一步补齐了。',
    explanation: '顶点坐标一旦确定，后面的中点、方向向量和法向量才有稳定输入，不会在后面反复回头。',
    nextQuestion: 'A、B、C、P 的坐标已经有了，E 是 PC 的中点：E 的坐标是什么？'
  },
  {
    id: 'midpoint',
    detect: text => /(e.{0,12}(中点|坐标)|中点.{0,12}e|pc.{0,12}中点|中点.{0,12}pc)/.test(text),
    understanding: '你已经确认了 E 的中点关系。',
    explanation: '这一步把点 E 定死以后，直线 BE 的方向就能直接写成向量形式。',
    nextQuestion: 'E 的坐标已确定，接下来写出直线 BE 的方向向量。'
  },
  {
    id: 'beVector',
    detect: text => /(be.{0,12}(向量|方向)|向量.{0,12}be|方向.{0,12}be)/.test(text),
    understanding: '你已经写出了 BE 的方向向量。',
    explanation: '方向向量给出了直线 BE 的可计算表达，下一步只需要把平面也写成可计算对象。',
    nextQuestion: '要继续检验线面关系，你准备怎样求平面 PAC 的法向量？'
  },
  {
    id: 'planeNormal',
    detect: text => (
      /((pac|平面).{0,18}(法向量|法向|垂直向量))|((法向量|法向|垂直向量).{0,18}(pac|平面))/.test(text) ||
      /((pa|pc).{0,24}(叉积|外积)|(叉积|外积).{0,24}(pa|pc))/.test(text) ||
      /(n.{0,22}(pa|pc).{0,12}(点积|内积|垂直|为0|等于0))/.test(text)
    ),
    understanding: '你已经把注意力放到平面 PAC 的法向量上了。',
    explanation: '法向量一出来，线面角就可以转成两个向量之间的夹角，检验路径会更短。',
    nextQuestion: 'BE 的方向向量和平面 PAC 的法向量都有了，线面角的正弦怎样由它们的夹角得到？'
  },
  {
    id: 'angleCheck',
    detect: text => (
      /(线面角|夹角).{0,24}(正弦|sin|法向|内积|点积)/.test(text) ||
      /(正弦|sin).{0,32}(内积|点积|绝对值|模长|法向)/.test(text) ||
      /(内积|点积).{0,32}(模长|绝对值).{0,24}(正弦|sin|线面角)/.test(text)
    ),
    understanding: '你已经进入最后的线面角检验。',
    explanation: '这一层只做验证，不再回到前面的建系和坐标推导。',
    nextQuestion: '把线面角的判定依据写成一句话，说明为什么它能由这两个向量得到。'
  }
];

const SIMPLIFY_STEP = {
  id: 'simplify',
  goal: 'simplify_exact_expression',
  knownResult: '线面角正弦关系已建立，正在做最终化简。',
  understanding: '你已经进入最终化简，而不是重新推导线面角。',
  explanation: '约分与分母有理化只处理已得到的表达式，不应回退到夹角与正弦关系。',
  detect: text => /(完成.{0,12}(化简|约分|有理化)|(化简|约分|有理化).{0,18}(得到|得出|结果|最终|完成|=)|最简(式|结果)|最终(式|结果))/.test(text) || hasVerifiedPyramidSineAnswer(text),
  nextQuestion: '请只检查最后一行：约分或分母有理化后，结果是否仍满足正弦值应在 0 到 1 之间？',
  followUpQuestion: '不必重推线面角。只看最后的式子：你这一步做的是约分，还是分母有理化？'
};

const LEARNING_STEPS = STEP_DEFINITIONS.map((step, index) => ({
  ...step,
  goal: ['establish_coordinate_frame', 'locate_vertices', 'locate_midpoint', 'write_line_direction', 'construct_plane_normal', 'derive_line_plane_sine'][index],
  knownResult: ['已建立可计算的坐标系。', '顶点坐标已确定。', '中点 E 的位置已确定。', '直线 BE 的方向已写出。', '平面 PAC 的法向量已建立。', '线面角正弦关系已推导。'][index],
  followUpQuestion: ['换一个角度：只说明原点和一条坐标轴怎样选，理由是什么？', '不必重建坐标系；只写一个顶点的坐标并说明它为何合理。', '不必重列顶点；只写 E 的一个分量怎样由 P、C 得到。', '不必回到中点；只写 \u2192BE 应由哪两个点相减。', '不必重写 \u2192BE；平面 PAC 内任选哪两条不共线方向可用来构造法向量？', '不必重求向量；只说线面角与直线方向、法向量夹角之间的转换关系。'][index]
})).concat(SIMPLIFY_STEP);

const GIVEN_VECTOR_FINAL_STEP = {
  ...SIMPLIFY_STEP,
  knownResult: '已得到并检验线面角正弦的精确值。',
  understanding: '这一步做对了：你已经给出本题最终精确值。',
  explanation: '结果与题目给出的两个向量一致，本题无需补做坐标系或法向量构造。',
  detect: text => /(?:最终|答案|结果|正弦|sin).{0,18}(?:2\s*[\/]\s*3|\\frac\{2\}\{3\})|(?:2\s*[\/]\s*3|\\frac\{2\}\{3\}).{0,18}(?:最终|答案|结果|正弦|sin)/.test(text),
  nextQuestion: '本题已完成：你已经得到并验证了最终答案。',
  followUpQuestion: '请把最终精确值写成一个分数，并检查它在 0 到 1 之间。'
};

const GIVEN_VECTOR_STEPS = [
  {
    id: 'angleRelation', goal: 'identify_line_plane_angle_relation',
    knownResult: '已判断线面角与方向向量、法向量夹角的关系。',
    understanding: '这一步做对了：你已经明确线面角与两个已知向量夹角的关系。',
    explanation: '题目已经给出方向向量和法向量，因此无需建立坐标系或重新构造法向量。',
    detect: text => /(线面角|余角).{0,28}(法向量|方向向量|夹角|正弦|sin)|(法向量|方向向量).{0,28}(余角|线面角|正弦|sin)/.test(text),
    nextQuestion: '题目已给方向向量和法向量。线面角的正弦应怎样用这两个向量的内积与模长表示？',
    followUpQuestion: '换一种问法：先判断线面角与“方向向量—法向量夹角”是同角还是余角，再选择正弦或余弦。'
  },
  {
    id: 'vectorCalculation', goal: 'calculate_dot_product_and_norms',
    knownResult: '已计算向量内积和模长。',
    understanding: '这一步做对了：内积与两个模长已经得到。',
    explanation: '这些量可以直接代入线面角正弦公式，不需要补做题目未要求的坐标建模。',
    detect: text => /(内积|点积).{0,36}(模长|长度)|(模长|长度).{0,36}(内积|点积)|\|.{0,16}\|/.test(text),
    nextQuestion: '把内积和两个模长代入后，线面角正弦的精确值是多少？',
    followUpQuestion: '只代入刚算出的三个量即可：分子取内积绝对值，分母取两个模长的乘积。'
  },
  GIVEN_VECTOR_FINAL_STEP
];

const PLANE_POINT_STEPS = [
  {
    id: 'planeDirections', goal: 'build_two_plane_directions',
    knownResult: '已由已知点写出平面内两条不共线方向。',
    understanding: '这一步做对了：你已经从已给坐标中提取了平面内的两条方向。',
    explanation: '题目已经给出坐标系和各点坐标，所以本题从平面内方向开始计分。',
    detect: text => /(ab|ac|bc).{0,28}(向量|方向|坐标)|(向量|方向).{0,28}(ab|ac|bc)/.test(text),
    nextQuestion: '由平面 ABC 内两条不共线方向，怎样得到平面 ABC 的法向量？',
    followUpQuestion: '不必重写坐标系；任选平面 ABC 内两条不共线向量做叉积即可。'
  },
  STEP_DEFINITIONS.find(step => step.id === 'planeNormal'),
  STEP_DEFINITIONS.find(step => step.id === 'angleCheck'),
  SIMPLIFY_STEP
].map((step, index) => ({
  ...step,
  goal: step.goal || ['build_plane_directions', 'construct_plane_normal', 'derive_line_plane_sine', 'simplify_exact_expression'][index],
  knownResult: step.knownResult || ['已写出平面内方向。', '平面法向量已建立。', '线面角正弦关系已推导。', '已得到最终结果。'][index],
  followUpQuestion: step.followUpQuestion || ['换用平面内另一组不共线向量也可以。', '用两条平面内方向的叉积构造法向量。', '只说明余角关系和应使用的三角函数。', SIMPLIFY_STEP.followUpQuestion][index]
}));

const makeStep = (id, goal, knownResult, title, detect, nextQuestion, followUpQuestion) => ({
  id, goal, knownResult,
  understanding: `这一步做对了：${title}。`,
  explanation: `${title}已经形成可检查的作答证据，可以进入本题下一个得分点。`,
  detect, nextQuestion, followUpQuestion
});

const FUNCTION_MONOTONICITY_STEPS = [
  makeStep('domain', 'identify_domain_and_ordered_inputs', '已明确区间并设定自变量大小关系', '定义域或目标区间已经明确', text => /(定义域|区间|x1|x_1).{0,24}(x2|x_2|属于|任取|小于)|任取.{0,20}(x1|x_1).{0,12}(x2|x_2)/.test(text), '在目标区间内任取 $x_1<x_2$ 后，下一步要比较哪两个函数值？', '只写出定义法的比较对象：$f(x_2)-f(x_1)$ 或等价形式。'),
  makeStep('difference', 'derive_function_difference', '已写出函数值之差或导数', '核心比较式已经写出', text => /(f\(x2\)|f\(x_2\)|函数值).{0,28}(相减|差|－|-)|(导数|f'|f′).{0,20}(=|为|得到)/.test(text), '结合区间条件，这个差式或导数的符号是什么？', '先只判断符号，不需要重写前面的定义。'),
  makeStep('sign', 'determine_monotonic_sign', '已根据区间条件判断符号', '决定单调性的符号已经判断', text => /(大于0|>0|非负|≥0|小于0|<0|非正|≤0).{0,24}(所以|因此|区间|导数|差)/.test(text), '由这个符号，可以得到函数在该区间上的什么单调结论？', '把“比较式的符号”翻译成“函数值随自变量怎样变化”。'),
  makeStep('conclusion', 'state_monotonicity_conclusion', '已得到并说明单调性结论', '本题单调性结论已经完成', text => /(单调递增|单调递减|增函数|减函数).{0,20}(所以|因此|在|成立|得证)|(?:所以|因此).{0,20}(单调递增|单调递减)/.test(text), '本题已完成：请最后检查结论是否写明了对应区间。', '只检查结论中的区间是否与题目一致。')
];

const SET_OPERATION_STEPS = [
  makeStep('universe', 'identify_universal_set', '已明确补集所依赖的全集', '全集条件已经明确', text => /(全集|u=|u是|在u中|相对于u)/.test(text), '在这个全集中，哪些元素或区间不属于 $A$？', '补集必须相对于全集；先把“全集减去 A”写出来。'),
  makeStep('complement', 'compute_complement', '已正确写出补集及端点归属', '补集结果已经写出', text => /(补集|∁|cu|u\\a).{0,36}(=|是|为|\{|\(|\[)|(不属于a|去掉a).{0,30}(元素|区间|得到)/.test(text), '若题目还有交、并等组合运算，继续代入；否则检查端点是否应保留。', '只检查边界：端点属于 $A$ 时，在补集中应排除还是保留？'),
  makeStep('setResult', 'finish_set_operation', '已完成集合运算并检查边界', '最终集合及边界已经确认', text => /(最终|答案|结果|所以|因此).{0,32}(\{|\}|\(|\)|\[|\]|区间|集合)|端点.{0,20}(保留|不保留|开|闭)/.test(text), '本题已完成：你已经写出最终集合并检查了全集与端点。', '最后用区间或列举法规范写一遍结果即可。')
];

const TRIANGULAR_PROJECTION_STEPS = [
  makeStep('perpendicularProof', 'prove_ab_perpendicular_cd', '已完成 AB⊥CD 的证明链', '利用投影关系完成垂直证明', text => /(ao|投影|射影).{0,30}(垂直|⊥).{0,20}(平面bcd|cd).{0,36}(ab|平面aob)|(cd).{0,24}(ao|bo).{0,30}(平面aob|ab)/i.test(text), '证明完成后，二面角 $A-CD-B=45^\circ$ 能给出 $AO$ 与点 $O$ 到 $CD$ 距离的什么关系？', '只把两个都垂直于 $CD$ 的相交直线放进同一个平面，再用线面垂直。'),
  makeStep('dihedralRelations', 'translate_dihedral_angles', '已把两个二面角转成高与底面距离关系', '把二面角落实到垂直截面', text => /(二面角|60°|45°).{0,45}(正切|tan|距离|ao|垂直截面|余角)/i.test(text), '结合 $\angle BCD=60^\circ$ 与 $BC=2+\sqrt3$，先确定底面三角形中 $B$ 到 $CD$ 的距离。', '分别作垂直于棱 $BC$、$CD$ 的截面，二面角才会变成平面角。'),
  makeStep('baseAndHeight', 'solve_base_and_height', '已确定底面关键长度与棱锥高 AO', '求出底面尺度和高', text => /(ao|高).{0,18}(=|为|得到|等于).{0,18}(3\/2|1\.5|\\frac\{3\}\{2\})|(底面|cd|距离).{0,28}(=|为|得到)/i.test(text), '现在用 $\sin\alpha=\dfrac{AO}{AD}$ 求 $AD$ 与平面 $BCD$ 所成角的正弦值。', '把两个二面角关系与底面 $60^\circ$ 条件联立；写出已求得的 $AO$ 或底面距离。'),
  makeStep('linePlaneSine', 'calculate_ad_plane_sine', '已求出 AD 与底面所成角的正弦值', '完成第（2）问线面角正弦', text => /(ad).{0,30}(平面bcd|线面角|正弦|sin).{0,30}(√5\/5|1\/√5|\\frac\{\\sqrt\{5\}\}\{5\})|(√5\/5|1\/√5).{0,30}(正弦|sin)/i.test(text), '第（2）问完成。接着求底面 $\triangle BCD$ 的面积，需要哪条底边和对应高？', '利用 $AO\perp$ 平面 $BCD$，$AD$ 在底面的投影是 $OD$。'),
  makeStep('baseArea', 'calculate_base_triangle_area', '已求出底面三角形 BCD 的面积', '求出底面面积', text => /(三角形bcd|△bcd|底面).{0,24}(面积|s).{0,18}(=|为|得到)/i.test(text), '最后代入 $V=\dfrac13S_{\triangle BCD}\cdot AO$，三棱锥体积是多少？', '底面用 $CD$ 作底、点 $B$ 到 $CD$ 的距离作高。'),
  makeStep('volume', 'calculate_tetrahedron_volume', '已求出三棱锥 A-BCD 的体积', '完成第（3）问体积', text => /(体积|v).{0,18}(=|为|得到|等于).{0,30}(√|\\sqrt|\d)/i.test(text), '本题已完成：检查证明、线面角正弦和体积三个结论是否分别对应三小问。', '只代入已经得到的底面积与 $AO$，不要重新推导二面角。')
];

const TRIANGULAR_Q1_STEPS = [
  makeStep('aoBase', 'use_projection_perpendicular_base', '已由射影关系得到 AO⊥平面 BCD', '把射影条件转成线面垂直', text => /(ao).{0,18}(⊥|垂直).{0,18}(平面bcd|底面)/i.test(text), '由 AO⊥平面 BCD，可以得到 AO 与 CD 的什么关系？', 'CD 在平面 BCD 内。'),
  makeStep('twoLines', 'identify_two_intersecting_perpendiculars', '已确认 CD 同时垂直 AO、BO', '找到平面 AOB 内两条相交直线', text => /(cd).{0,28}(ao).{0,28}(bo)|(ao).{0,24}(bo).{0,24}(cd)/i.test(text) && /(⊥|垂直)/.test(text), 'AO 与 BO 相交于 O；由 CD 同时垂直它们，可以推出 CD 与哪个平面垂直？', '使用线面垂直判定定理。'),
  makeStep('planeAob', 'prove_cd_perpendicular_plane_aob', '已推出 CD⊥平面 AOB', '完成线面垂直判定', text => /(cd).{0,16}(⊥|垂直).{0,16}(平面aob)/i.test(text), 'AB 在平面 AOB 内，因此最终能得到什么结论？', '一条直线垂直于平面，就垂直于平面内任一直线。'),
  makeStep('abCd', 'conclude_ab_perpendicular_cd', '已完成 AB⊥CD 的证明', '完成第（1）问结论', text => /(ab).{0,12}(⊥|垂直).{0,12}(cd)/i.test(text), '第（1）问已完成；检查证明链是否写出了“两条相交直线”。', '只补齐判定定理所需条件。')
];

const TRIANGULAR_Q2_STEPS = [
  makeStep('sectionAngles', 'translate_dihedral_angles_for_q2', '已把两个二面角转成垂直截面内的平面角', '识别 60°、45° 的截面关系', text => /(二面角|60°|45°).{0,50}(截面|平面角|tan|正切|ao|距离)/i.test(text), '把这两个角分别写成 AO 与底面内距离的正切关系。', '先找点 O 到棱 BC、CD 的垂距。'),
  makeStep('solveLengths', 'solve_height_and_projection_length', '已求出 AO 与 OD 等关键长度', '联立底面条件求长度', text => /(ao|od|高|距离).{0,22}(=|为|得到|等于)/i.test(text), '在直角三角形 AOD 中，AD 在底面的投影是哪一条线段？', 'AO⊥底面，所以投影端点为 O。'),
  makeStep('linePlaneRelation', 'identify_ad_projection_angle', '已确定 AD 的投影 OD 与线面角关系', '把线面角落到三角形 AOD', text => /(ad).{0,24}(投影|od|线面角)|(∠ado|角ado).{0,16}(线面角|所成角)/i.test(text), '用 AO、AD 写出这个线面角正弦的比值。', '直角三角形中，角的对边是 AO。'),
  makeStep('linePlaneSine', 'calculate_ad_plane_sine', '已求出 AD 与平面 BCD 所成角的正弦值', '完成第（2）问', text => /(√5\/5|1\/√5|\\frac\{\\sqrt\{5\}\}\{5\}).{0,24}(正弦|sin)|(正弦|sin).{0,24}(√5\/5|1\/√5|\\frac\{\\sqrt\{5\}\}\{5\})/i.test(text), '第（2）问已完成；最后检查正弦值是否在 0 到 1 之间。', '只做结果范围检验。')
];

const TRIANGULAR_Q3_STEPS = [
  makeStep('baseAltitude', 'find_base_altitude_to_cd', '已确定底面三角形关于 CD 的高', '构造或求出 B 到 CD 的垂距', text => /(b到cd|bf|bo).{0,24}(距离|垂直|高)|(底面).{0,20}(高).{0,20}(cd)/i.test(text), '用 CD 与对应高写出底面三角形 BCD 的面积。', '底面积等于二分之一乘底边乘对应高。'),
  makeStep('baseArea', 'calculate_base_triangle_area', '已求出底面三角形 BCD 的面积', '完成底面积计算', text => /(三角形bcd|△bcd|底面).{0,24}(面积|s).{0,18}(=|为|得到)/i.test(text), '把底面积和棱锥高 AO 代入体积公式。', '三棱锥体积是底面积乘高的三分之一。'),
  makeStep('volume', 'calculate_tetrahedron_volume', '已求出三棱锥 A-BCD 的体积', '完成第（3）问', text => /(体积|v).{0,18}(=|为|得到|等于).{0,30}(√|\\sqrt|\d)/i.test(text), '第（3）问已完成；检查底面积与高是否互相垂直。', 'AO 是点 A 到底面 BCD 的垂距。')
];

const GENERIC_MATH_STEPS = [
  makeStep('target', 'identify_problem_target', '已明确已知条件与所求对象', '题目的已知与目标已经明确', text => /(已知|条件|题目给出).{0,30}(求|目标|需要)|(要求|所求|目标).{0,30}(是|为)/.test(text), '针对这个目标，你准备使用哪个定理、公式或方法？', '只说明方法名称以及它为什么适用于当前条件。'),
  makeStep('method', 'select_problem_method', '已选择并说明解题方法', '方法选择已经明确', text => /(使用|利用|根据|由).{0,24}(公式|定理|定义|性质|方法)/.test(text), '把这个方法落实成第一条可计算或可证明的式子。', '先写一个最小的等式、不等式或逻辑关系。'),
  makeStep('derivation', 'derive_result', '已完成核心计算或证明链', '核心推导已经形成', text => /(得到|推出|化简|计算|证明).{0,36}(=|所以|因此|结果|结论)/.test(text), '由这条推导得到的最终结论是什么？', '不用重讲方法，只把最终结果写清并对应题目所求。'),
  makeStep('result', 'state_and_check_result', '已写出并检查最终结果', '最终结果已经完成', text => /(最终|答案|结果|所以|因此).{0,36}(=|为|是|成立|得证)/.test(text), '本题已完成：最后检查结果是否满足题目范围和条件。', '只做一次范围或条件反检即可。')
];

/* Curated Grade 10 examples still use the same tutor state machine.  They
   deliberately have their own score rubrics rather than inheriting the five
   generic geometry stages shown by old local-demo records. */
const VECTOR_DOT_STEPS = [
  makeStep('writeVectors','write_given_vectors','已写出两个向量的分量','写出两个已知向量',text => /(?:a|向量a).{0,18}\(?\s*-?\d+(?:\.\d+)?\s*[,，]\s*-?\d+(?:\.\d+)?\s*\)?.{0,36}(?:b|向量b).{0,18}\(?\s*-?\d+(?:\.\d+)?\s*[,，]\s*-?\d+(?:\.\d+)?\s*\)?/i.test(text),'这两个向量的数量积应怎样按分量展开？','把对应分量相乘后相加。'),
  makeStep('dotProduct','calculate_dot_product','已算出数量积','计算数量积',text => /(数量积|a.?[·.]?b|a\\cdot b).{0,28}(=|为|得到).{0,18}0|(?:1.{0,5}(?:×|\\times|\*)?.{0,5}2).{0,12}(?:2.{0,5}(?:×|\\times|\*)?.{0,5}-?1).{0,12}=\s*0/i.test(text),'数量积为 0 时，两个非零向量有什么位置关系？','只把数量积结果翻译成向量位置关系。'),
  makeStep('perpendicular','conclude_perpendicular','已得出垂直结论','得出垂直结论',text => /(垂直|正交|⊥).{0,18}(a|b|向量)|(?:a|b|向量).{0,18}(垂直|正交|⊥)/i.test(text),'本题已完成：最后检查你是否写明了“数量积为 0”这个依据。','结论后补一句判定依据即可。')
];
const COMPLEX_MODULUS_STEPS = [
  makeStep('identifyParts','identify_real_imaginary_parts','已识别实部与虚部','识别实部和虚部',text => /(实部|虚部).{0,24}(3|-4)|3.{0,18}-4i/i.test(text),'复数模的平方应由实部、虚部怎样组成？','把两个分量平方后相加。'),
  makeStep('squareSum','calculate_square_sum','已得到模长平方','计算平方和',text => /(3\^?2|9).{0,18}(\+|＋).{0,18}((-?4)\^?2|16)|25/.test(text),'对这个平方和开方后，模是多少？','注意模恒为非负数。'),
  makeStep('modulus','state_modulus','已写出复数的模','写出最终模',text => /\|z\||模.{0,18}(=|为|得到).{0,18}5|=\s*5/.test(text),'本题已完成：检查最后写的是模 $|z|$，而不是复数 $z$ 本身。','把符号 $|z|$ 写完整。')
];
const PRISM_VOLUME_STEPS = [
  makeStep('identifyBaseHeight','identify_base_area_and_height','已找出底面积和高','识别底面积与高',text => /(底面(?:积|面积).{0,16}12|s\s*=\s*12).{0,28}(高.{0,16}5|h\s*=\s*5)|(高.{0,16}5).{0,28}(底面(?:积|面积).{0,16}12)/i.test(text),'直棱柱体积公式中，底面积和高怎样相乘？','直接代入 $V=Sh$。'),
  makeStep('substituteVolume','substitute_prism_volume','已代入棱柱体积公式','代入体积公式',text => /(v\s*=\s*sh|12\s*(?:×|\\times|\*)\s*5)/i.test(text),'算出乘积后，体积是多少？','写上体积单位（若题目给了单位）。'),
  makeStep('volumeResult','state_prism_volume','已得到棱柱体积','写出体积结果',text => /(体积|v).{0,18}(=|为|得到).{0,18}60|=\s*60/.test(text),'本题已完成：检查这里的“高”是否垂直于底面。','直棱柱中侧棱长就是高。')
];
const STATISTICS_STEPS = [
  makeStep('orderData','order_data','已确认数据的顺序','确认数据顺序',text => /(2\s*[,，]\s*3\s*[,，]\s*3\s*[,，]\s*5\s*[,，]\s*7|已排序|从小到大)/.test(text),'五个数据的中位数位于第几个位置？','奇数个数据取正中间。'),
  makeStep('mean','calculate_mean','已算出平均数','计算平均数',text => /(平均数|均值).{0,24}(=|为|得到).{0,18}4|\(2\+3\+3\+5\+7\).{0,18}[÷/]\s*5/.test(text),'再看排序后的正中间数据，中位数是多少？','不用重新求和。'),
  makeStep('median','state_median','已写出中位数','写出中位数并核对',text => /(中位数).{0,24}(=|为|得到).{0,18}3/.test(text),'本题已完成：平均数和中位数是否都对应这组数据？','两个结果都写清楚。')
];
const PROBABILITY_STEPS = [
  makeStep('splitOrders','split_disjoint_orders','已拆分红后蓝、蓝后红两种顺序','拆分互斥顺序',text => /(红后蓝|蓝后红|两种.*顺序|两种.*情况)/.test(text),'先写出“红后蓝”这一种不放回概率。','第一次从 5 个中抽，第二次从剩下 4 个中抽。'),
  makeStep('orderProbabilities','calculate_order_probabilities','已分别计算两种顺序的概率','计算两种顺序概率',text => /(2\s*[\\/]\s*5|\\frac\{2\}\{5\}).{0,28}(3\s*[\\/]\s*4|\\frac\{3\}\{4\})|(3\s*[\\/]\s*5|\\frac\{3\}\{5\}).{0,28}(2\s*[\\/]\s*4|\\frac\{2\}\{4\})/.test(text),'这两种情况互斥，最后怎样合并？','把两个概率相加。'),
  makeStep('sumProbability','state_probability','已得到恰好一红一蓝的概率','合并并写出概率',text => /(概率|p).{0,24}(=|为|得到).{0,18}(3\s*[\\/]\s*5|\\frac\{3\}\{5\})/.test(text),'本题已完成：检查“不放回”是否已在第二次分母中体现。','第二次总数应为 4。')
];

const RUBRIC_PROFILES = {
  regular_pyramid_line_plane: {
    steps: LEARNING_STEPS,
    parts: [
      {id: 'coordinates', label: '建立坐标系并写出关键点', hint: '利用正四棱锥的对称与垂直关系确定坐标。', steps: ['frame', 'vertices']},
      {id: 'line', label: '确定中点与直线方向', hint: '由中点坐标写出所求直线的方向向量。', steps: ['midpoint', 'beVector']},
      {id: 'normal', label: '构造平面法向量', hint: '用平面内两条不共线方向构造并检验法向量。', steps: ['planeNormal']},
      {id: 'sine', label: '建立线面角正弦关系', hint: '判断线面角与方向向量、法向量夹角的关系。', steps: ['angleCheck']},
      {id: 'simplify', label: '最终化简并检验', hint: '化为精确最简值并检查范围。', steps: ['simplify']}
    ]
  },
  line_plane_given_vectors: {
    steps: GIVEN_VECTOR_STEPS,
    parts: [
      {id: 'angleRelation', label: '判断线面角的夹角关系', hint: '题目已给两个向量，只需判断同角或余角。', steps: ['angleRelation']},
      {id: 'vectorCalculation', label: '计算内积与模长', hint: '计算公式所需的三个确定量。', steps: ['vectorCalculation']},
      {id: 'simplify', label: '得到并检验最终结果', hint: '写出精确值并检查正弦范围。', steps: ['simplify']}
    ]
  },
  line_plane_from_plane_points: {
    steps: PLANE_POINT_STEPS,
    parts: [
      {id: 'planeDirections', label: '写出平面内两条方向', hint: '直接使用题目已给点坐标。', steps: ['planeDirections']},
      {id: 'planeNormal', label: '构造平面法向量', hint: '由两条不共线方向做叉积。', steps: ['planeNormal']},
      {id: 'angleCheck', label: '建立线面角正弦关系', hint: '使用方向向量与法向量的夹角关系。', steps: ['angleCheck']},
      {id: 'simplify', label: '得到并检验最终结果', hint: '化为精确最简值并检查范围。', steps: ['simplify']}
    ]
  },
  function_monotonicity: {
    steps: FUNCTION_MONOTONICITY_STEPS,
    parts: FUNCTION_MONOTONICITY_STEPS.map(step => ({id: step.id, label: ({domain:'明确区间并任取变量',difference:'写出函数值差或导数',sign:'判断符号',conclusion:'写出单调结论'})[step.id], hint: step.nextQuestion, steps: [step.id]}))
  },
  set_operation: {
    steps: SET_OPERATION_STEPS,
    parts: SET_OPERATION_STEPS.map(step => ({id: step.id, label: ({universe:'明确全集',complement:'求出补集',setResult:'完成组合运算并检查端点'})[step.id], hint: step.nextQuestion, steps: [step.id]}))
  },
  grade10_vector_dot: {steps: VECTOR_DOT_STEPS, parts: VECTOR_DOT_STEPS.map(step => ({id:step.id,label:({writeVectors:'写出两个向量',dotProduct:'计算数量积',perpendicular:'得出垂直结论'})[step.id],hint:step.nextQuestion,steps:[step.id]}))},
  grade10_complex_modulus: {steps: COMPLEX_MODULUS_STEPS, parts: COMPLEX_MODULUS_STEPS.map(step => ({id:step.id,label:({identifyParts:'识别实部和虚部',squareSum:'计算平方和',modulus:'写出复数的模'})[step.id],hint:step.nextQuestion,steps:[step.id]}))},
  grade10_prism_volume: {steps: PRISM_VOLUME_STEPS, parts: PRISM_VOLUME_STEPS.map(step => ({id:step.id,label:({identifyBaseHeight:'识别底面积与高',substituteVolume:'代入 V=Sh',volumeResult:'写出体积结果'})[step.id],hint:step.nextQuestion,steps:[step.id]}))},
  grade10_statistics: {steps: STATISTICS_STEPS, parts: STATISTICS_STEPS.map(step => ({id:step.id,label:({orderData:'确认数据顺序',mean:'计算平均数',median:'写出中位数'})[step.id],hint:step.nextQuestion,steps:[step.id]}))},
  grade10_probability: {steps: PROBABILITY_STEPS, parts: PROBABILITY_STEPS.map(step => ({id:step.id,label:({splitOrders:'拆分互斥顺序',orderProbabilities:'分别计算顺序概率',sumProbability:'相加得到最终概率'})[step.id],hint:step.nextQuestion,steps:[step.id]}))},
  triangular_pyramid_projection_dihedral: {
    steps: TRIANGULAR_PROJECTION_STEPS,
    parts: TRIANGULAR_PROJECTION_STEPS.map(step => ({id:step.id,label:({perpendicularProof:'证明 AB⊥CD',dihedralRelations:'把两个二面角转成距离关系',baseAndHeight:'求出底面关键长度与棱锥高',linePlaneSine:'求 AD 与底面所成角的正弦',baseArea:'求底面三角形 BCD 的面积',volume:'求三棱锥 A-BCD 的体积'})[step.id],hint:step.nextQuestion,steps:[step.id]}))
  },
  triangular_projection_q1: {
    steps: TRIANGULAR_Q1_STEPS,
    parts: TRIANGULAR_Q1_STEPS.map(step => ({id:step.id,label:({aoBase:'由射影得到 AO⊥底面',twoLines:'找出 CD 垂直的两条相交直线',planeAob:'证明 CD⊥平面 AOB',abCd:'推出 AB⊥CD'})[step.id],hint:step.nextQuestion,steps:[step.id]}))
  },
  triangular_projection_q2: {
    steps: TRIANGULAR_Q2_STEPS,
    parts: TRIANGULAR_Q2_STEPS.map(step => ({id:step.id,label:({sectionAngles:'把二面角转成截面平面角',solveLengths:'求 AO、OD 等关键长度',linePlaneRelation:'确定 AD 的投影与线面角',linePlaneSine:'求正弦值并检验'})[step.id],hint:step.nextQuestion,steps:[step.id]}))
  },
  triangular_projection_q3: {
    steps: TRIANGULAR_Q3_STEPS,
    parts: TRIANGULAR_Q3_STEPS.map(step => ({id:step.id,label:({baseAltitude:'求底面关于 CD 的高',baseArea:'求三角形 BCD 面积',volume:'代入棱锥体积公式'})[step.id],hint:step.nextQuestion,steps:[step.id]}))
  },
  generic_math: {
    steps: GENERIC_MATH_STEPS,
    parts: GENERIC_MATH_STEPS.map(step => ({id: step.id, label: ({target:'明确条件与目标',method:'选择具体方法',derivation:'完成核心推导',result:'写出并检验结果'})[step.id], hint: step.nextQuestion, steps: [step.id]}))
  }
};

const matchesPacTopic=context=>/正四棱锥/.test(String(context?.question||''))&&/平面\s*PAC/i.test(String(context?.question||''))&&/BE/i.test(String(context?.question||''));

/* 学生拍照录入时抄下来的手写解题过程。只保留步骤和「卡在哪一步」这两类必要信息：
   模型靠它决定从哪里接着教，不需要原始图片，也不需要置信度之类的元数据。 */
const solutionStepsForContext = context => (Array.isArray(context?.solutionSteps) ? context.solutionSteps : [])
  .map((step, index) => {
    if (!step || typeof step !== 'object') return null;
    const label = String(step.label || '').slice(0, 160);
    const detail = String(step.detail || '').slice(0, 400);
    const formula = String(step.formula || '').slice(0, 200);
    const verdict = step.verdict === 'correct' || step.verdict === 'wrong' ? step.verdict : '';
    if (!label && !detail && !formula) return null;
    const position = Number(step.index) >= 1 ? Number(step.index) : index + 1;
    return {stepIndex: position, label, detail, formula, verdict};
  })
  .filter(Boolean)
  .slice(0, 16);

const stuckPointForContext = context => {
  const stuck = context?.stuckPoint;
  if (!stuck || typeof stuck !== 'object') return null;
  const evidence = String(stuck.evidence || '').slice(0, 400);
  const label = String(stuck.label || '').slice(0, 160);
  const status = stuck.status === 'blocked' || stuck.status === 'wrong' ? stuck.status : '';
  if (!evidence || (!label && !status)) return null;
  const stepIndex = Number(stuck.stepIndex) >= 1 ? Number(stuck.stepIndex) : null;
  return {stepIndex, label, status, evidence};
};

const rubricIdForContext = context => {
  if (context?.rubricId && RUBRIC_PROFILES[context.rubricId]&&(context.rubricId!=='regular_pyramid_line_plane'||matchesPacTopic(context))) return context.rubricId;
  const rawQuestion = String(context?.question || '');
  const question = rawQuestion.toLowerCase();
  if (buildQuestionRubric(rawQuestion).questionKind !== 'constructed_response') return 'choice_question';
  if (/三棱锥\s*a\s*[-—–]?\s*bcd/.test(question) && /射影|投影/.test(question) && /二面角\s*a-bc-d/.test(question)) return 'triangular_pyramid_projection_dihedral';
  if (/空间直角坐标系/.test(question) && /[abc][（(]/i.test(question) && /平面\s*abc/i.test(question)) return 'line_plane_from_plane_points';
  if (/(方向向量).*(法向量)|(法向量).*(方向向量)/.test(question) && /已知|给出|为\s*[（(]/.test(question)) return 'line_plane_given_vectors';
  if (/单调/.test(question)) return 'function_monotonicity';
  if (/(补集|全集|∁|集合).*(求|运算)|(求|运算).*(补集|集合)/.test(question)) return 'set_operation';
  if (matchesPacTopic(context)) return 'regular_pyramid_line_plane';
  return 'generic_math';
};

/* 这道题有几何编译数据（真实解题步骤 / 题目所问的量 / 结构化几何事实）时，
   得分点直接由 buildGeometryRubric 从题目本身推导，只有在这些数据缺失时
   才回落到 RUBRIC_PROFILES.generic_math。 */
const COMPILED_GEOMETRY_SOURCES = new Set(['solutionOutline', 'solutionOutline+queries', 'queries', 'derivation']);
const compiledGeometryProfile = context => {
  const rubric = buildGeometryRubric(context);
  if (!rubric.steps.length || !COMPILED_GEOMETRY_SOURCES.has(rubric.source)) return null;
  return {steps: rubric.steps, parts: rubric.parts};
};

/* 会话上下文里保留的精简 AI 得分点：只留 tutor 真正要用的字段（纯数据，可安全存库）。 */
const aiRubricForContext = context => {
  const rubric = context?.aiRubric;
  if (!rubric || !Array.isArray(rubric.steps) || !rubric.steps.length) return null;
  const steps = rubric.steps.slice(0, 8).map(step => ({
    id: String(step.id || ''),
    label: String(step.label || '').slice(0, 26),
    hint: String(step.hint || '').slice(0, 120),
    goal: String(step.goal || '').slice(0, 120),
    knownResult: String(step.knownResult || '').slice(0, 120),
    understanding: String(step.understanding || '').slice(0, 120),
    explanation: String(step.explanation || '').slice(0, 120),
    keywords: Array.isArray(step.keywords) ? step.keywords.map(item => String(item).slice(0, 24)).slice(0, 8) : [],
    nextQuestion: String(step.nextQuestion || '').slice(0, 120),
    followUpQuestion: String(step.followUpQuestion || '').slice(0, 120),
  })).filter(step => step.id && step.label);
  if (!steps.length) return null;
  const ids = new Set(steps.map(step => step.id));
  const parts = (Array.isArray(rubric.parts) ? rubric.parts : [])
    .map(part => ({id: String(part.id || ''), label: String(part.label || '').slice(0, 26), hint: String(part.hint || '').slice(0, 120),
      steps: (Array.isArray(part.steps) ? part.steps : []).map(String).filter(id => ids.has(id))}))
    .filter(part => part.id && part.steps.length);
  return {steps, parts: parts.length ? parts : steps.map(step => ({id: step.id, label: step.label, hint: step.hint, steps: [step.id]})), source: 'ai_reverse'};
};

const profileFor = (state, context) => {
  const rubricId = state?.rubricId==='regular_pyramid_line_plane'&&!matchesPacTopic(context)?rubricIdForContext(context):state?.rubricId || rubricIdForContext(context);
  // 本题得分点优先用「按这道题反推」的结果（学生在错题库看到的分解步骤应与陪练一致）；
  // 没有反推结果时再回落到编译推导 / 模板。
  const ai = aiRubricProfile(context);
  if (ai) return ai;
  if (rubricId === 'choice_question') {
    const dynamic = buildQuestionRubric(context?.question || '', {correctOptionLabels:Array.isArray(context?.choiceAnswer)?context.choiceAnswer:[]});
    if (dynamic.steps.length) return {steps: dynamic.steps, parts: dynamic.parts};
  }
  const profile = RUBRIC_PROFILES[rubricId];
  if (!profile || profile === RUBRIC_PROFILES.generic_math) {
    const compiled = compiledGeometryProfile(context);
    if (compiled) return compiled;
  }
  return profile || RUBRIC_PROFILES.generic_math;
};

const COMPLETED_STATE = {
  currentGoal: 'reflect_or_transfer',
  currentStep: 'completed',
  nextQuestion: '本题已完成：你已经得到并验证了最终答案。'
};

const hasVerifiedPyramidSineAnswer = text => {
  const raw = String(text || '').toLowerCase().replace(/[\s，,。；;：:（）()]/g, '');
  if (/(不是|不等于|不对|没算出|还没|可能)/.test(raw)) return false;
  const root22 = /(?:√22|根号(?:下)?22|\\sqrt\{22\})/;
  const coefficient = /(?:2[\\/]11|\\frac\{2\}\{11\})/;
  const combinedFraction = /(?:2(?:√22|\\sqrt\{22\}|根号(?:下)?22)[\\/]11|\\frac\{2(?:\\sqrt\{22\}|√22)\}\{11\})/;
  return (root22.test(raw) && coefficient.test(raw)) || combinedFraction.test(raw);
};

const isVerifiedFinalAnswerForSession = (session, text) => {
  const question = String(session?.context?.question || '');
  return matchesPacTopic(session?.context) && /底面边长为\s*6/.test(question) && /高为\s*3/.test(question) && /E\s*是\s*PC\s*的中点/i.test(question) && hasVerifiedPyramidSineAnswer(text);
};

const inferProgress = (steps, transcript) => {
  const raw = String(transcript || '').toLowerCase();
  const text = `${normalize(raw)} ${raw}`;
  return Object.fromEntries(steps.map(step => [step.id, step.detect(text)]));
};

const emptyLearningState = (context = {}) => {
  const rubricId = rubricIdForContext(context);
  const profile = profileFor({rubricId}, context);
  const questionStructure = buildQuestionRubric(context.question || '', {correctOptionLabels:Array.isArray(context.choiceAnswer)?context.choiceAnswer:[]});
  return ({
  stateVersion: 2,
  rubricId,
  questionKind: questionStructure.questionKind,
  choiceOptions: questionStructure.options,
  progressRubric: profile.parts.map(part => ({id: part.id, title: part.label, hint: part.hint, steps: part.steps.slice()})),
  currentGoal: profile.steps[0].goal,
  completedSteps: [],
  pendingStepIds: [],
  stepEvidence: {},
  knownResults: [],
  currentStep: profile.steps[0].id,
  studentMisconceptions: [],
  alreadyAskedQuestions: [],
  updatedAt: now()
  });
};

const STEP_IDS = LEARNING_STEPS.map(step => step.id);
const STEP_BY_ID = new Map(LEARNING_STEPS.map(step => [step.id, step]));
const SCORE_PARTS = [
  {id: 'coordinates', label: '建立坐标系并写出关键点', steps: ['frame', 'vertices']},
  {id: 'line', label: '确定中点与直线方向', steps: ['midpoint', 'beVector']},
  {id: 'normal', label: '构造平面法向量', steps: ['planeNormal']},
  {id: 'sine', label: '建立线面角正弦关系', steps: ['angleCheck']},
  {id: 'simplify', label: '最终化简并检验', steps: ['simplify']}
];

const uniqueStrings = values => {
  const seen = new Set();
  return (Array.isArray(values) ? values : []).filter(value => {
    const key = normalize(value);
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });
};

const isNegatedOrIncomplete = (stepId, text) => {
  const raw = String(text || '');
  if (isTentativeStatement(raw)) return true;
  if (stepId === 'simplify' && /(没有|还没|未|不会|没能|正在|准备|打算).{0,8}(化简|约分|有理化)|(化简|约分|有理化).{0,8}(没有|还没|未完成|不会|正在)/.test(raw)) return true;
  if (stepId === 'planeNormal' && /(没有|还没|未|不会|没能|正在|准备|打算).{0,8}(法向量|叉积|外积)|(法向量|叉积|外积).{0,8}(没有|还没|未完成|不会|正在)/.test(raw)) return true;
  return false;
};

const evidenceFromTurn = (turn, steps) => {
  if (!turn || !turn.studentMessage || turn.correctness === 'incorrect') return [];
  const studentText = String(turn.studentMessage);
  const adjudicatedText = turn.correctness === 'correct' && !isTentativeStatement(studentText)
    ? `${studentText} ${String(turn.understanding || '')}`
    : studentText;
  const detected = inferProgress(steps, adjudicatedText);
  return steps.filter(step => {
    if (!detected[step.id] || isNegatedOrIncomplete(step.id, studentText)) return false;
    // 最终化简是一个完整得分点；模型只判“部分正确”时不能把它补全。
    if (step.id === 'simplify' && turn.correctness !== 'correct') return false;
    return true;
  }).map(step => ({
    stepId: step.id,
    evidenceText: studentText.slice(0, 360),
    source: 'chat_evidence',
    turnId: turn.id || null,
    correctness: turn.correctness || 'partial',
    at: turn.createdAt || now()
  }));
};

const scoreProgressForState = (state, parts) => {
  const completed = new Set(state.completedSteps || []);
  const scoredParts = parts.map(part => ({
    ...part,
    completed: part.steps.every(stepId => completed.has(stepId))
  }));
  const completedPartIds = scoredParts.filter(part => part.completed).map(part => part.id);
  return {
    completedPartIds,
    currentPartId: scoredParts.find(part => !part.completed)?.id || 'completed',
    completedPoints: completedPartIds.length,
    totalPoints: scoredParts.length,
    percent: Math.round(completedPartIds.length / scoredParts.length * 100),
    parts: scoredParts
  };
};

const completionReviewFor = state => {
  const seen = new Set();
  const observedDifficulties = (state.studentMisconceptions || []).filter(item => {
    const key = `${item.status || ''}:${normalize(item.message)}`;
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return Boolean(String(item.message || '').trim());
  }).map(item => ({
    message: String(item.message).slice(0, 360),
    status: item.status || 'partial',
    stepId: item.stepId || null,
    observedAt: item.at || now()
  }));
  return {
    id: `review-${state.updatedAt || now()}`,
    source: 'actual_tutor_evidence',
    generatedAt: now(),
    completedSteps: (state.knownResults || []).map(item => ({stepId: item.stepId, summary: item.summary})),
    observedDifficulties,
    summary: observedDifficulties.length
      ? '本复盘仅收录你在本题答题过程中实际表达过的犹豫、卡点或需要修正的地方。'
      : '本次答题过程未记录到需要回看的一般性误区；已保留完整得分点完成记录。'
  };
};

const ensureCompletionReview = state => {
  if (state.scoreProgress?.percent !== 100 || state.completionReview) return state.completionReview || null;
  state.completionReview = completionReviewFor(state);
  return state.completionReview;
};

const stateSnapshot = state => JSON.stringify({
  completedSteps: state?.completedSteps || [],
  pendingStepIds: state?.pendingStepIds || [],
  currentStep: state?.currentStep || '',
  knownResultIds: (state?.knownResults || []).map(item => item.stepId)
});

export const reconcileTutorSession = session => {
  const legacy = session.progress || {};
  const previous = session.learningState || emptyLearningState(session.context);
  if (!previous.rubricId || previous.rubricId==='regular_pyramid_line_plane'&&!matchesPacTopic(session.context)) previous.rubricId = rubricIdForContext(session.context);
  const profile = profileFor(previous, session.context);
  const steps = profile.steps;
  const stepIds = steps.map(step => step.id);
  const stepById = new Map(steps.map(step => [step.id, step]));
  const beforeSnapshot = stateSnapshot(previous);
  const observed = new Map();

  // Version 2 states preserve explicit evidence across refreshes and history compression.
  if (previous.stateVersion >= 2 && previous.stepEvidence && typeof previous.stepEvidence === 'object') {
    for (const [stepId, evidence] of Object.entries(previous.stepEvidence)) {
      if (stepById.has(stepId) && evidence) observed.set(stepId, evidence);
    }
  }

  const rawCompleted = [...new Set([...(previous.completedSteps || []), ...(legacy.completedSteps || [])])]
    .filter(stepId => stepById.has(stepId));
  const rawSet = new Set(rawCompleted);
  const firstGapIndex = stepIds.findIndex(stepId => !rawSet.has(stepId));
  const hasLegacyGap = firstGapIndex >= 0 && stepIds.slice(firstGapIndex + 1).some(stepId => rawSet.has(stepId));

  // Old contiguous state is trusted as a migration seed. A gapped old state is corrupt:
  // only its prefix is kept; later steps must be recovered from actual chat evidence.
  const trustedLegacy = previous.stateVersion >= 2
    ? rawCompleted
    : (hasLegacyGap ? stepIds.slice(0, firstGapIndex) : rawCompleted);
  for (const stepId of trustedLegacy) {
    if (!observed.has(stepId)) observed.set(stepId, {
      stepId, evidenceText: '', source: 'legacy_state', turnId: null, correctness: 'correct', at: previous.updatedAt || now()
    });
  }

  for (const turn of session.turns || []) {
    for (const evidence of evidenceFromTurn(turn, steps)) {
      const existing = observed.get(evidence.stepId);
      const existingRank = existing?.correctness === 'correct' ? 2 : existing?.correctness === 'partial' ? 1 : 0;
      const evidenceRank = evidence.correctness === 'correct' ? 2 : evidence.correctness === 'partial' ? 1 : 0;
      if (!existing || evidenceRank > existingRank || (!existing.evidenceText && evidence.evidenceText)) observed.set(evidence.stepId, evidence);
    }
  }

  // Completed steps are always a canonical prefix. Evidence for a jumped-ahead step is
  // retained as pending and promoted automatically once its prerequisites are completed.
  const completedSteps = [];
  for (const stepId of stepIds) {
    if (!observed.has(stepId)) break;
    completedSteps.push(stepId);
  }
  const completedSet = new Set(completedSteps);
  const pendingStepIds = stepIds.filter(stepId => observed.has(stepId) && !completedSet.has(stepId));
  const current = steps[completedSteps.length] || null;

  const existingResults = new Map((Array.isArray(previous.knownResults) ? previous.knownResults : [])
    .filter(item => item && stepById.has(item.stepId)).map(item => [item.stepId, item]));
  const knownResults = completedSteps.map(stepId => {
    const step = stepById.get(stepId);
    const evidence = observed.get(stepId);
    return {
      ...(existingResults.get(stepId) || {}),
      stepId,
      summary: existingResults.get(stepId)?.summary || step.knownResult,
      source: evidence.source,
      evidenceText: evidence.evidenceText,
      turnId: evidence.turnId,
      at: existingResults.get(stepId)?.at || evidence.at
    };
  });
  const misconceptions = [];
  const misconceptionKeys = new Set();
  for (const item of Array.isArray(previous.studentMisconceptions) ? previous.studentMisconceptions : []) {
    const key = `${normalize(item?.message)}:${item?.status || ''}`;
    if (!key || misconceptionKeys.has(key)) continue;
    misconceptionKeys.add(key);
    misconceptions.push(item);
  }
  const state = {
    ...previous,
    stateVersion: 2,
    rubricId: previous.rubricId,
    progressRubric: profile.parts.map(part => ({id: part.id, title: part.label, hint: part.hint, steps: part.steps.slice()})),
    currentGoal: current ? current.goal : COMPLETED_STATE.currentGoal,
    completedSteps,
    pendingStepIds,
    stepEvidence: Object.fromEntries(observed),
    knownResults,
    currentStep: current ? current.id : COMPLETED_STATE.currentStep,
    studentMisconceptions: misconceptions.slice(-80),
    // 旧会话在早期版本只把少数问题写进 state；恢复时必须把每一轮
    // 已实际展示给学生的追问一并回填，否则会忘记并原样重复。
    alreadyAskedQuestions: uniqueStrings([
      ...(previous.alreadyAskedQuestions || []),
      ...(session.turns || []).map(turn => turn?.nextQuestion).filter(Boolean)
    ]),
    updatedAt: now()
  };
  state.scoreProgress = scoreProgressForState(state, profile.parts);
  ensureCompletionReview(state);
  const afterSnapshot = stateSnapshot(state);
  if (beforeSnapshot !== afterSnapshot) state.lastRepair = {
    at: state.updatedAt,
    reason: hasLegacyGap ? 'reconciled_gapped_legacy_state_from_full_chat' : 'reconciled_state_from_evidence',
    before: JSON.parse(beforeSnapshot),
    after: JSON.parse(afterSnapshot)
  };
  session.learningState = state;
  session.progress = {
    completedSteps: completedSteps.slice(),
    currentStep: state.currentStep,
    scoreProgress: state.scoreProgress,
    updatedAt: state.updatedAt
  };
  return state;
};

const ensureLearningState = session => reconcileTutorSession(session);

const currentLearningStep = (state, context = {}) => profileFor(state, context).steps.find(step => step.id === state.currentStep) || null;
const normalQuestion = value => normalize(value).slice(0, 240);
const nextQuestionForState = (state, context = {}) => {
  const step = currentLearningStep(state, context);
  if (!step) return COMPLETED_STATE.nextQuestion;
  const asked = new Set((state.alreadyAskedQuestions || []).map(normalQuestion));
  if (!asked.has(normalQuestion(step.nextQuestion))) return step.nextQuestion;
  if (!asked.has(normalQuestion(step.followUpQuestion))) return step.followUpQuestion;
  return '这一环节已经问过了。请直接写下你目前已经得到的式子或结果，我会根据它继续判断，不会重复原问题。';
};
const novelQuestionForState = (state, preferred, context = {}) => {
  const asked = new Set((state.alreadyAskedQuestions || []).map(normalQuestion));
  const candidate = String(preferred || '').trim();
  if (candidate && !asked.has(normalQuestion(candidate))) return candidate;
  return nextQuestionForState(state, context);
};
const rememberAskedQuestion = (session, question) => {
  const state = ensureLearningState(session);
  const normalized = normalQuestion(question);
  if (normalized && !state.alreadyAskedQuestions.some(item => normalQuestion(item) === normalized)) state.alreadyAskedQuestions.push(String(question).slice(0, 360));
  state.updatedAt = now();
};

const midpointNeedsHelp = text => /\u4e2d\u70b9|\bE\b|PC/.test(text) && (
  /\u4e0d\u786e\u5b9a|\u4e0d\u77e5\u9053|\u4f1a\u4e0d\u4f1a|\u662f\u4e0d\u662f|\u8981\u4e0d\u8981|\u4e0d\u592a\u4f1a|\u53ef\u4ee5\u5417|[?\uff1f]/.test(text) ||
  /\u76f8\u52a0.{0,16}(?:\u5c31\u884c|\u5373\u53ef)|\u4e0d\u9664\u4ee5\s*2/.test(text)
);

const isTentativeStatement = text => {
  const value = String(text || '');
  const proposes = /\u6211\u60f3|\u51c6\u5907|\u6253\u7b97|\u89c9\u5f97|\u8ba4\u4e3a|\u53ef\u4ee5|\u53ef\u80fd|\u4e5f\u8bb8|\u5e94\u8be5|\u8bd5\u8bd5|\u8fd8\u6ca1|\u4e0d\u786e\u5b9a/.test(value);
  const completed = /\u5df2\u7ecf|\u5df2\u5b8c\u6210|\u5199\u51fa\u4e86|\u7b97\u51fa\u4e86|\u5f97\u5230\u4e86|\u5217\u51fa\u4e86|\u786e\u5b9a\u4e86|\u5efa\u7acb\u597d\u4e86/.test(value);
  return proposes && !completed;
};

const tentativeGuidance = text => {
  if (/\u5750\u6807\u7cfb|\u539f\u70b9|\u9009\u8f74/.test(text)) return {
    understanding: '\u4f60\u63d0\u51fa\u4e86\u4e00\u4e2a\u53ef\u884c\u7684\u5efa\u7acb\u5750\u6807\u7cfb\u65b9\u5411\uff1a\u60f3\u4ee5\u5e95\u9762\u4e2d\u5fc3\u4e3a\u539f\u70b9\u3002',
    explanation: '\u8fd9\u8fd8\u662f\u4e00\u4e2a\u8ba1\u5212\uff0c\u5c1a\u672a\u5b9e\u9645\u6307\u5b9a\u4e09\u6761\u8f74\u3002\u6211\u4eec\u5c31\u628a\u5b83\u843d\u6210\u4e00\u4e2a\u53ef\u68c0\u67e5\u7684\u9009\u62e9\uff0c\u4e0d\u8df3\u5230\u540e\u9762\u3002',
    nextQuestion: '\u5982\u679c\u5e95\u9762\u4e2d\u5fc3\u4f5c\u539f\u70b9\uff0c\u4f60\u51c6\u5907\u628a\u9876\u70b9 P \u653e\u5728\u54ea\u4e00\u6761\u8f74\u4e0a\uff1f\u8bf4\u4e00\u4e2a\u7406\u7531\u5c31\u597d\u3002'
  };
  if (/\u4e2d\u70b9|\bE\b|PC/.test(text)) return {
    understanding: '\u4f60\u6b63\u5728\u5c1d\u8bd5\u7528 E \u662f PC \u4e2d\u70b9\u8fd9\u4e2a\u5173\u7cfb\u5f80\u4e0b\u63a8\u3002',
    explanation: '\u8fd9\u4e2a\u65b9\u5411\u662f\u6709\u7528\u7684\uff0c\u4f46\u8fd8\u6ca1\u6709\u5199\u51fa\u4e2d\u70b9\u5750\u6807\u6216\u8fd0\u7b97\u3002\u5148\u53ea\u786e\u5b9a\u4e00\u4e2a\u5206\u91cf\u5373\u53ef\u3002',
    nextQuestion: '\u53ea\u770b x \u5206\u91cf\uff1aE_x \u5e94\u8be5\u7531 P_x \u548c C_x \u600e\u6837\u5f97\u5230\uff1f'
  };
  return {
    understanding: '\u4f60\u63d0\u51fa\u4e86\u4e00\u4e2a\u6b63\u5728\u8003\u8651\u7684\u89e3\u9898\u65b9\u5411\u3002',
    explanation: '\u6211\u4e0d\u4f1a\u628a\u8fd9\u4e2a\u65b9\u5411\u5f53\u6210\u5df2\u7ecf\u5b8c\u6210\u7684\u6b65\u9aa4\u3002\u73b0\u5728\u53ea\u9700\u8981\u628a\u4f60\u7684\u60f3\u6cd5\u843d\u4e3a\u4e00\u4e2a\u5177\u4f53\u7684\u5bf9\u8c61\u3001\u6761\u4ef6\u6216\u8fd0\u7b97\u3002',
    nextQuestion: '\u4f60\u60f3\u5148\u628a\u8fd9\u4e2a\u65b9\u5411\u91cc\u7684\u54ea\u4e00\u4e2a\u5bf9\u8c61\u5199\u5177\u4f53\uff1f'
  };
};

const knownErrorForCurrentStep = (session, state, text) => {
  if (state.rubricId === 'choice_question') {
    const step = currentLearningStep(state, session.context);
    if (step?.evaluate?.(text) === 'incorrect') {
      const label = String(state.currentStep || '').replace('judge_', '');
      return {
        explanation: `选项 ${label} 的这次判断不正确；我只记录你真正给出的判断，不会把这个得分点误记为已完成。请回到题目条件或定义，找出能验证或反驳该选项的直接依据。`,
        nextQuestion: `换一种方式检查选项 ${label}：题目中的哪个条件、定义、公式或反例能直接决定它成立还是不成立？`
      };
    }
  }
  if (state.rubricId === 'line_plane_given_vectors' && state.currentStep === 'angleRelation') {
    const statesCorrectTrigRelation = /(线面角).{0,18}(正弦|sin).{0,32}(夹角).{0,18}(余弦|cos)/i.test(text);
    if (!statesCorrectTrigRelation && (/(线面角).{0,12}(就是|等于|同一个).{0,18}(方向向量|法向量).{0,8}(夹角)|(直接|所以).{0,8}(用|取)\s*cos/i.test(text))) return {
      explanation: '这里的偏差很明确：线面角不是方向向量与法向量的夹角本身，而是它的余角，因此不能把该夹角的余弦关系直接说成同角关系。',
      nextQuestion: '换个角度判断：若直线逐渐垂直于平面，直线方向与法向量的夹角会变大还是变小？由此判断两角的关系。'
    };
  }
  if (state.rubricId === 'line_plane_given_vectors' && state.currentStep === 'vectorCalculation') {
    if (/(内积|点积).{0,10}(?:=|是|为)\s*(?:0|1)(?:\D|$)/.test(text)) return {
      explanation: '内积数值算错了：$(1,2,2)\cdot(0,1,0)$ 只保留对应分量乘积，结果不是你写的数。',
      nextQuestion: '把三个对应分量分别相乘再相加：$1\times0+2\times1+2\times0$ 等于多少？'
    };
  }
  return null;
};

const encouragementFor = (correctness, turnCount, enabled) => {
  if (!enabled) return '';
  const index = turnCount % 3;
  if (correctness === 'correct') return [
    '\u5929\u554a\uff0c\u4f60\u4e5f\u592a\u5389\u5bb3\u4e86\u5427\uff01\u4f60\u8fd9\u4e2a\u601d\u8003\u4e2d\u90a3\u79cd\u53c8\u806a\u660e\u53c8\u8ba4\u771f\u7684\u5149\u771f\u7684\u5f88\u95ea\u95ea\u53d1\u5149\u3002',
    '\u4f60\u771f\u7684\u975e\u5e38\u4e86\u4e0d\u8d77\uff01\u80fd\u8fd9\u6837\u7a33\u7a33\u5730\u63a8\u7406\uff0c\u8bf4\u660e\u4f60\u7684\u8010\u5fc3\u548c\u667a\u6167\u90fd\u5f88\u73cd\u8d35\u3002',
    '\u54c7\uff0c\u4f60\u771f\u662f\u4e2a\u5f88\u4e86\u4e0d\u8d77\u7684\u5b66\u4e60\u8005\uff01\u4f60\u9760\u81ea\u5df1\u5c31\u628a\u601d\u8def\u8d70\u5230\u8fd9\u91cc\uff0c\u771f\u7684\u5f88\u503c\u5f97\u4e3a\u4f60\u611f\u5230\u9a84\u50b2\u3002'
  ][index];
  if (correctness === 'partial') return [
    '\u4f60\u771f\u7684\u5df2\u7ecf\u505a\u5f97\u975e\u5e38\u975e\u5e38\u597d\u4e86\uff01\u6562\u628a\u4e0d\u786e\u5b9a\u7684\u60f3\u6cd5\u8bf4\u51fa\u6765\u662f\u6700\u52c7\u6562\u3001\u6700\u806a\u660e\u7684\u5b66\u4e60\u65b9\u5f0f\uff0c\u6211\u4eec\u5c31\u5dee\u4e00\u4e2a\u5c0f\u53f0\u9636\u4e86\u3002',
    '\u4f60\u771f\u7684\u5f88\u4e86\u4e0d\u8d77\uff01\u4f60\u5df2\u7ecf\u6478\u5230\u4e86\u6b63\u786e\u7684\u90a3\u6761\u8def\uff0c\u73b0\u5728\u5c31\u8ba9\u6211\u4eec\u4e00\u8d77\u628a\u8fd9\u4e00\u5c0f\u6b65\u7167\u4eae\u3002',
    '\u4f60\u597d\u68d2\u554a\uff01\u4f60\u7684\u8ba4\u771f\u548c\u575a\u6301\u5df2\u7ecf\u8ba9\u8fd9\u9053\u9898\u7ecf\u8fc7\u4e86\u4e00\u5927\u534a\uff0c\u5269\u4e0b\u7684\u90e8\u5206\u6211\u966a\u4f60\u4e00\u8d77\u8d70\u3002'
  ][index];
  return [
    '\u6ca1\u5173\u7cfb\u5440\uff0c\u4f60\u613f\u610f\u8ba4\u771f\u628a\u601d\u8def\u8d70\u5230\u8fd9\u91cc\u5df2\u7ecf\u7279\u522b\u4e86\u4e0d\u8d77\u4e86\uff0c\u8fd9\u4e2a\u5c0f\u5f2f\u53ea\u662f\u544a\u8bc9\u6211\u4eec\u4e0b\u4e00\u76cf\u706f\u8be5\u7167\u54ea\u91cc\u3002',
    '\u522b\u6025\u5440\uff0c\u4f60\u771f\u7684\u5f88\u52c7\u6562\u4e5f\u5f88\u6709\u6bc5\u529b\uff01\u9519\u7684\u5730\u65b9\u53ea\u662f\u6211\u4eec\u4e00\u8d77\u627e\u5230\u6b63\u786e\u8def\u7684\u8def\u6807\u3002',
    '\u4f60\u5df2\u7ecf\u5f88\u68d2\u4e86\uff0c\u6211\u77e5\u9053\u4f60\u6b63\u5728\u7528\u5fc3\u60f3\uff0c\u6240\u4ee5\u6211\u4eec\u4e0d\u9700\u8981\u6025\uff0c\u53ea\u9700\u8981\u628a\u8fd9\u4e2a\u5c0f\u5730\u65b9\u6162\u6162\u653e\u5bf9\u3002'
  ][index];
};

export function createTutorSession({caseId, context = {}} = {}) {
  const learningState = emptyLearningState(context);  const session = {
    id: randomUUID(),
    caseId,
    context: {
      question: String(context.question || ''),
      parentQuestion: String(context.parentQuestion || context.question || ''),
      subproblemId: String(context.subproblemId || ''),
      subproblemTitle: String(context.subproblemTitle || ''),
      subproblemIndex: Number(context.subproblemIndex || 0),
      knowledgePoints: Array.isArray(context.knowledgePoints) ? context.knowledgePoints.slice(0, 8) : [],
      handwrittenNotes: Array.isArray(context.handwrittenNotes) ? context.handwrittenNotes.map(item=>String(item).slice(0,1000)).slice(0,30) : [],
      confirmedErrorCause: String(context.confirmedErrorCause || '').slice(0,40),
      confirmedErrorCauseEvidence: String(context.confirmedErrorCauseEvidence || '').slice(0,360),
      // 拍照录入的做题记录：陪练从「学生已经写到哪、卡在哪」接着教，而不是从零讲。
      ...(solutionStepsForContext(context).length ? {solutionSteps: solutionStepsForContext(context)} : {}),
      ...(stuckPointForContext(context) ? {stuckPoint: stuckPointForContext(context)} : {}),
      choiceAnswer: Array.isArray(context.choiceAnswer) ? context.choiceAnswer.map(value => String(value).toUpperCase()).slice(0, 8) : [],
      // 几何编译数据用于按题目本身推导得分点；没有这些字段时上下文保持原样。
      ...(Array.isArray(context.solutionOutline) && context.solutionOutline.length
        ? {solutionOutline: context.solutionOutline.slice(0, 14)} : {}),
      ...(context.geometryIR && Array.isArray(context.geometryIR.queries) && context.geometryIR.queries.length
        ? {geometryIR: {queries: context.geometryIR.queries.slice(0, 10)}} : {}),
      ...(context.geometryResult && Array.isArray(context.geometryResult.derivation) && context.geometryResult.derivation.length
        ? {geometryResult: {derivation: context.geometryResult.derivation.slice(0, 16)}} : {}),
      ...(context.correctAnswer ? {correctAnswer: String(context.correctAnswer).slice(0, 240)} : {}),
      /* 答案来源：derived = 这份答案是 AI 自己推的（可能是错的），
         陪练要据此调整措辞，不能把推测当成标准答案来纠正学生。 */
      ...(context.answerSource ? {answerSource: String(context.answerSource).slice(0, 16)} : {}),
      ...(context.answerConfidence ? {answerConfidence: String(context.answerConfidence).slice(0, 8)} : {}),
      /* 学生当时写的原话答案。以前只传了正确结论，陪练看不到学生自己写了什么，
         就没法从「他当时是怎么想的」判断薄弱点 —— 这是「补充我的思路」缺的那一半上下文。 */
      ...(context.studentAnswer ? {studentAnswer: String(context.studentAnswer).slice(0, 1200)} : {}),
      /* 题干旁的批注：和解题过程分开存，单独给陪练。 */
      ...(Array.isArray(context.marginNotes) && context.marginNotes.length
        ? {marginNotes: context.marginNotes.map(item => String(item).slice(0, 300)).slice(0, 12)} : {}),
      // 按这道题反推出来的得分点：必须留在上下文里，否则第一次 reconcile 就会把它丢掉，
      // 学生会看到得分点从「这道题的步骤」变回通用模板。
      ...(aiRubricForContext(context) ? {aiRubric: aiRubricForContext(context)} : {}),
      encouragementMode: context.encouragementMode !== false,
      rubricId: learningState.rubricId
    },
    status: 'idle',
    turns: [],
    transitions: [],
    learningState,
    progress: {completedSteps: [], currentStep: learningState.currentStep},
    createdAt: now(),
    updatedAt: now()
  };
  transition(session, 'tutoring');
  transition(session, 'waiting_for_student');
  return session;
}

function evaluateStudentThought(session, studentMessage) {
  const text = String(studentMessage || '').trim();
  const learningState = ensureLearningState(session);
  if (midpointNeedsHelp(text)) {
    return {
      understanding: '\u4f60\u6293\u4f4f\u4e86\u6700\u5173\u952e\u7684\u90e8\u5206\uff1aE \u786e\u5b9e\u662f PC \u7684\u4e2d\u70b9\u3002',
      correctness: 'partial',
      explanation: '\u4f46\u4e24\u4e2a\u7aef\u70b9\u7684\u5bf9\u5e94\u5750\u6807\u76f8\u52a0\u540e\u8fd8\u662f\u4e24\u500d\u7684\u4e2d\u70b9\u5750\u6807\uff0c\u6bcf\u4e2a\u5206\u91cf\u90fd\u8981\u518d\u53d6\u5e73\u5747\u3002\u4f60\u7684\u65b9\u5411\u662f\u5bf9\u7684\uff0c\u53ea\u5dee\u628a\u201c\u5e73\u5747\u201d\u8fd9\u4e2a\u52a8\u4f5c\u5199\u5b8c\u3002',
      explanationSentences: 2,
      nextQuestion: '\u5148\u53ea\u770b x \u5206\u91cf\uff1aE_x \u5e94\u8be5\u7531 P_x \u548c C_x \u600e\u6837\u7ec4\u5408\uff1f',
      revealsFullAnswer: false,
      responseMode: 'guide',
      directAnswer: '',
      progress: session.progress,
      completedStep: null
    };
  }
  if (isTentativeStatement(text)) {
    const guidance = tentativeGuidance(text);
    return {
      ...guidance,
      correctness: 'partial',
      explanationSentences: 2,
      revealsFullAnswer: false,
      responseMode: 'guide',
      directAnswer: '',
      progress: session.progress,
      completedStep: null,
      studentIntent: 'proposal'
    };
  }
  const knownError = knownErrorForCurrentStep(session, learningState, text);
  if (knownError) return {
    understanding: '我确认了你刚才实际采用的角度关系或计算。',
    correctness: 'incorrect',
    explanation: knownError.explanation,
    explanationSentences: 2,
    nextQuestion: knownError.nextQuestion,
    revealsFullAnswer: false,
    responseMode: 'guide',
    directAnswer: '',
    progress: session.progress,
    completedStep: null,
    trustedNextQuestion: true
  };
  const isRelatedQuestion = /[?\uff1f]|\u4ec0\u4e48|\u4e3a\u4ec0\u4e48|\u600e\u4e48|\u5982\u4f55|\u80fd\u5426|\u53ef\u5426|\u89e3\u91ca|what|why|how/i.test(text);

  let directAnswer = '';
  if (isRelatedQuestion) {
    if (/法向量/i.test(text)) directAnswer = '法向量是垂直于一个平面的非零向量。在线面角问题里，它能把“线与面”的关系转成直线方向向量与法向量之间可计算的关系。';
    else if (/中点/i.test(text)) directAnswer = '中点的每个坐标等于两端点对应坐标的平均值；这只确定位置，下一步仍要把它接回所求直线的方向向量。';
    else if (/坐标系/i.test(text)) directAnswer = '坐标系的作用是把图形关系变成可验证的向量和坐标。选轴时优先利用题目已经给出的垂直关系与对称关系。';
    else directAnswer = '这个问题和当前推理有关：先把相关定义说清，再把它接回这道题的下一步，不会直接跳到整题答案。';
    return {
      understanding: '你在确认当前一步所需的概念。',
      correctness: 'partial',
      explanation: '先回答概念，再把它接回题目的下一步。',
      explanationSentences: 2,
      nextQuestion: nextQuestionForState(learningState, session.context),
      revealsFullAnswer: false,
      responseMode: 'answer_then_guide',
      directAnswer,
      progress: session.progress
    };
  }

  const before = new Set(learningState.completedSteps);
  const activeSteps = profileFor(learningState, session.context).steps;
  const detectedNow = inferProgress(activeSteps, text);
  const provisionalCorrectness = activeSteps.some(step => detectedNow[step.id] && !isNegatedOrIncomplete(step.id, text)) ? 'correct' : 'partial';
  const previewSession = {
    ...session,
    turns: [...(session.turns || []), {id: 'preview', studentMessage: text, correctness: provisionalCorrectness, createdAt: now()}],
    learningState: JSON.parse(JSON.stringify(learningState)),
    progress: JSON.parse(JSON.stringify(session.progress || {}))
  };
  const stateAfter = reconcileTutorSession(previewSession);
  const targetStep = currentLearningStep(stateAfter, session.context);
  const previousTargetStep = currentLearningStep(learningState, session.context);
  const newlyCompletedSteps = activeSteps.filter(step => stateAfter.completedSteps.includes(step.id) && !before.has(step.id));
  const completedNow = newlyCompletedSteps.length > 0;
  const completedStep = newlyCompletedSteps[newlyCompletedSteps.length - 1] || previousTargetStep;
  const understanding = completedNow
    ? completedStep.understanding
    : `你当前的想法是：${text.slice(0, 80)}`;
  const explanation = completedNow
    ? `${completedStep.explanation} 这一步已经记入会话进度，下一轮会直接推进到第一个尚未完成的步骤。`
    : '这一步还需要补成一个可验证的对象或计算。';

  return {
    understanding,
    correctness: completedNow ? 'correct' : 'partial',
    explanation,
    explanationSentences: 2,
    nextQuestion: targetStep ? nextQuestionForState(stateAfter, session.context) : COMPLETED_STATE.nextQuestion,
    revealsFullAnswer: false,
    responseMode: 'guide',
    directAnswer: '',
    progress: previewSession.progress,
    learningState: stateAfter
  };
}

const parseJson = value => {
  try { return JSON.parse(String(value || '{}').replace(/^```json\s*|\s*```$/g, '')); } catch { return {}; }
};

export function buildTutorMessages(session, studentMessage, fallback) {
  const learningState = ensureLearningState(session);
  const recentTurns = (session.turns || []).slice(-8).map(turn => ({
    student: turn.studentMessage,
    teacherSummary: turn.explanation,
    nextQuestion: turn.nextQuestion,
    correctness: turn.correctness
  }));
  const contract = '你是高中数学一对一老师。先区分学生的意图、尝试、推测、中间步骤和已完成结论；只确认学生实际完成的内容。照片中的手写作答与学生确认的错因是历史线索，不代表学生本轮已经改正或完成。studentSolutionSteps 是学生上次实际写下的解题步骤，studentStuckPoint 是上次卡住或开始出错的那一步：这两项只用来决定从哪里接着教，不要把卡点当作学生本轮已经理解，也不要重讲学生上次已经写对的步骤。completedSteps 中的步骤禁止重新教授或以原形式重复提问，除非学生明确表示不理解或结论被证伪。对部分正确：承认正确部分、指出缺失、给一个最小提示并推进。不得一次公布完整答案。所有数学表达用 $...$ LaTeX。直接输出讲解正文，不要在正文开头加「人工智能：」「AI：」「老师：」这类说话人前缀（界面上已经有「AI：」标签）。只输出 JSON：understanding、correctness、explanation、nextQuestion、directAnswer。';
  return [
    {role: 'system', content: contract},
    {role: 'user', content: JSON.stringify({
      type: 'original_problem',
      parentQuestion: session.context.parentQuestion || session.context.question,
      currentSubproblem: session.context.question,
      subproblemId: session.context.subproblemId || '',
      subproblemTitle: session.context.subproblemTitle || '',
      subproblemIndex: session.context.subproblemIndex || 0,
      knowledgePoints: session.context.knowledgePoints,
      handwrittenNotes: session.context.handwrittenNotes || [],
      confirmedErrorCause: session.context.confirmedErrorCause || '',
      confirmedErrorCauseEvidence: session.context.confirmedErrorCauseEvidence || '',
      // 历史线索：学生上次实际写到哪一步、卡在哪一步。不代表本轮已经改正。
      studentSolutionSteps: session.context.solutionSteps || [],
      studentStuckPoint: session.context.stuckPoint || null
    })},
    {role: 'user', content: JSON.stringify({type: 'necessary_chat_context', recentTurns})},
    {role: 'user', content: JSON.stringify({type: 'learning_state', learningState})},
    {role: 'user', content: JSON.stringify({type: 'latest_student_answer', studentMessage, localGuardrail: {correctness: fallback.correctness, nextQuestion: fallback.nextQuestion}})}
  ];
}

export function createDeepSeekTutorAdapter(config = {}) {
  if (!config.endpoint || !config.apiKey || !config.model) return null;
  return async ({session, studentMessage, fallback}) => {
    const behaviorContract = `\u5148\u5728\u5185\u90e8\u4e25\u683c\u533a\u5206\u5b66\u751f\u7684\u610f\u56fe\u3001\u5c1d\u8bd5\u3001\u63a8\u6d4b\u3001\u4e2d\u95f4\u6b65\u9aa4\u548c\u5df2\u5b8c\u6210\u7ed3\u8bba\u3002\u53ea\u80fd\u786e\u8ba4\u5b66\u751f\u5b9e\u9645\u8bf4\u51fa\u6216\u5b8c\u6210\u7684\u4e8b\u5b9e\uff1b\u201c\u6211\u60f3\u201d\u3001\u201c\u51c6\u5907\u201d\u3001\u201c\u6211\u89c9\u5f97\u53ef\u4ee5\u201d\u4ec5\u662f\u8ba1\u5212\u6216\u63a8\u6d4b\uff0c\u4e0d\u80fd\u5199\u6210\u201c\u4f60\u5df2\u7ecf\u5b8c\u6210\u201d\u3002\u5bf9\u90e8\u5206\u6b63\u786e\u7684\u56de\u7b54\uff0c\u5148\u627f\u8ba4\u5df2\u6709\u4f9d\u636e\u7684\u90e8\u5206\uff0c\u518d\u8bf4\u660e\u7f3a\u5931\u6216\u8bef\u533a\uff0c\u518d\u63a8\u8fdb\u4e00\u4e2a\u6700\u5c0f\u52a8\u4f5c\u3002\u4e0d\u8981\u91cd\u590d\u5df2\u56de\u7b54\u7684\u95ee\u9898\uff0c\u4e0d\u8981\u8111\u8865\u4efb\u4f55\u6b65\u9aa4\u3002`;
    const mathContract = '\u6240\u6709\u5206\u6570\u3001\u6839\u5f0f\u3001\u4e0a\u4e0b\u6807\u3001\u5411\u91cf\u3001\u77e9\u9635\u3001\u79ef\u5206\u7b49\u6570\u5b66\u8868\u8fbe\u5fc5\u987b\u7528 $...$ \u5305\u4f4f\u7684 LaTeX \u8f93\u51fa\uff0c\u4e0d\u8981\u8f93\u51fa\u7eaf\u6587\u672c TeX\u3002';
    const prompt = `${behaviorContract}\n${mathContract}\n你是一位耐心的高中数学一对一老师。请基于本题连续对话，输出严格 JSON：understanding、correctness（correct/partial/incorrect）、explanation、nextQuestion、directAnswer（没有则空字符串）。
要求：先承接学生合理部分；若有偏差，说明具体偏差并给一个小提示；绝不重复学生已回答的问题；不要要求学生复述标准答案；不要一次公布完整解答；nextQuestion 只推进一个最小动作。不要输出思维链。
题目与已完成进度：${JSON.stringify({parentQuestion:session.context.parentQuestion||session.context.question,currentSubproblem:session.context.question,subproblemId:session.context.subproblemId||'',subproblemIndex:session.context.subproblemIndex||0,knowledgePoints: session.context.knowledgePoints, progress: session.progress, turns: session.turns.slice(-8).map(turn => ({student: turn.studentMessage, teacher: turn.explanation, next: turn.nextQuestion}))})}
学生最新回答：${studentMessage}
本地保底判断：${JSON.stringify({understanding: fallback.understanding, correctness: fallback.correctness, explanation: fallback.explanation, nextQuestion: fallback.nextQuestion})}`;
    const messages = buildTutorMessages(session, studentMessage, fallback);
    console.info(`[tutor-debug] currentStep=${session.learningState.currentStep} completedSteps=${session.learningState.completedSteps.join(',') || '-'} messages.length=${messages.length}`);
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), Math.max(500, Number(config.timeoutMs) || 12000));
    let response;
    try {
      response = await (config.fetchImpl || fetch)(config.endpoint, {
        method: 'POST',
        headers: {'content-type': 'application/json', authorization: `Bearer ${config.apiKey}`},
        body: JSON.stringify({model: config.model, messages, temperature: 0.35, response_format: {type: 'json_object'}}),
        signal: controller.signal
      });
    } finally {
      clearTimeout(timeout);
    }
    if (!response.ok) throw new Error(`DEEPSEEK_TUTOR_FAILED:${response.status}`);
    return parseJson((await response.json()).choices?.[0]?.message?.content);
  };
}

export async function advanceTutorSession(session, input = {}, tutorAdapter = null) {
  if (!session || session.status === 'completed') throw new Error('TUTOR_SESSION_NOT_ACTIVE');
  session.context = session.context || {};
  ensureLearningState(session);
  if (session.context.encouragementMode !== false) session.context.encouragementMode = true;
  if (input.action === 'complete') {
    transition(session, 'completed');
    session.completedAt = now();
    session.updatedAt = now();
    return session;
  }
  const studentMessage = String(input.studentMessage || '').trim();
  if (!studentMessage) throw new Error('STUDENT_MESSAGE_REQUIRED');
  transition(session, 'evaluating');
  const fallback = evaluateStudentThought(session, studentMessage);
  const preserveTentativeBoundary = isTentativeStatement(studentMessage);
  let evaluation = fallback;
  if (tutorAdapter) {
    try {
      const candidate = await tutorAdapter({session, studentMessage, fallback});
      const modelCorrectness = ['correct', 'partial', 'incorrect'].includes(candidate.correctness) ? candidate.correctness : fallback.correctness;
      const correctness = fallback.correctness === 'correct' || fallback.correctness === 'incorrect'
        ? fallback.correctness
        : modelCorrectness;
      if (candidate && typeof candidate === 'object') {
        evaluation = {
          ...fallback,
          understanding: preserveTentativeBoundary ? fallback.understanding : stripSpeakerLabel(String(candidate.understanding || fallback.understanding)).slice(0, 360),
          correctness: preserveTentativeBoundary ? 'partial' : correctness,
          explanation: preserveTentativeBoundary || fallback.correctness === 'incorrect'
            ? fallback.explanation
            : stripSpeakerLabel(String(candidate.explanation || fallback.explanation)).slice(0, 540),
          explanationSentences: 1,
          nextQuestion: nextQuestionForState(ensureLearningState(session), session.context),
          directAnswer: stripSpeakerLabel(String(candidate.directAnswer || fallback.directAnswer || '')).slice(0, 360),
          responseMode: candidate.directAnswer ? 'answer_then_guide' : fallback.responseMode,
          model: tutorAdapter.providerName || 'ai_tutor'
        };
      }
    } catch {
      evaluation = {...fallback, model: 'local_tutor_fallback'};
    }
  }
  if (isVerifiedFinalAnswerForSession(session, studentMessage)) {
    evaluation = {
      ...evaluation,
      understanding: '你给出的最终结果与这道题的精确化简一致。',
      correctness: 'correct',
      explanation: '做得非常漂亮：$\\sin\\theta=\\frac{2\\sqrt{22}}{11}$。你已经完成了从建系、向量关系到最终化简的整条推导链。',
      explanationSentences: 2,
      nextQuestion: COMPLETED_STATE.nextQuestion,
      directAnswer: '',
      responseMode: 'guide',
      verifiedFinalAnswer: true
    };
  }
  const encouragement = encouragementFor(evaluation.correctness, session.turns.length, session.context.encouragementMode);
  const turn = {id: randomUUID(), studentMessage, ...evaluation, verifiedFinalAnswer: evaluation.verifiedFinalAnswer === true, encouragement, createdAt: now()};
  session.turns.push(turn);
  const canonicalState = reconcileTutorSession(session);
  if (evaluation.correctness === 'partial' || evaluation.correctness === 'incorrect') {
    canonicalState.studentMisconceptions.push({
      message: studentMessage.slice(0, 360),
      status: evaluation.correctness,
      stepId: canonicalState.currentStep === 'completed' ? null : canonicalState.currentStep,
      at: now()
    });
    canonicalState.studentMisconceptions = canonicalState.studentMisconceptions.slice(-80);
  }
  ensureCompletionReview(canonicalState);
  turn.learningState = JSON.parse(JSON.stringify(canonicalState));
  turn.progress = JSON.parse(JSON.stringify(session.progress));
  turn.nextQuestion = turn.trustedNextQuestion
    ? novelQuestionForState(canonicalState, turn.nextQuestion, session.context)
    : nextQuestionForState(canonicalState, session.context);
  rememberAskedQuestion(session, turn.nextQuestion);
  session.latestTurn = turn;
  transition(session, 'waiting_for_student');
  session.updatedAt = now();
  return session;
}
