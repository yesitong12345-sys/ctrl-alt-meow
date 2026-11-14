const SUBSCRIPTS = {'₀':'0','₁':'1','₂':'2','₃':'3','₄':'4','₅':'5','₆':'6','₇':'7','₈':'8','₉':'9'};
const KNOWN_SPECIES = new Set(['H2','O2','N2','Cl2','CO','CO2','H2O','CH4','NH3','Na','C','Fe','Mg','NaCl','C6H12O6']);

const normalize = value => String(value || '')
  .replace(/[₀₁₂₃₄₅₆₇₈₉]/g, digit => SUBSCRIPTS[digit])
  .replace(/[⇌↔⟶⟹]/g, '→')
  .replace(/\s+/g, '')
  .trim();

function speciesFromSide(side) {
  return side.split('+').map(token => token
    .replace(/^\d+(?:\.\d+)?/, '')
    .replace(/\((?:aq|s|l|g)\)$/i, '')
    .replace(/[↑↓]/g, ''))
    .filter(Boolean);
}

const sameSet = (actual, expected) => actual.length === expected.length
  && expected.every(item => actual.includes(item));

export function assessChemistryInput(questionText) {
  const raw = String(questionText || '').trim();
  const compact = normalize(raw);
  if (/酯化|乙酸.*乙醇|醋酸.*乙醇/.test(raw)) return {
    status: 'supported_reaction', courseKey: 'esterification', unsupportedSpecies: [],
    message: '已匹配酯化机理课程，可展示断键、成键、催化剂与过渡态。'
  };
  const arrow = compact.match(/(→|->|=)/);
  if (!arrow) {
    const formulaMatch = compact.match(/(?:^|[:：])([A-Z][A-Za-z0-9]*)$/);
    if (formulaMatch) return {
      status: 'formula_only', formula: formulaMatch[1], courseKey: null,
      speciesKnown: KNOWN_SPECIES.has(formulaMatch[1]), unsupportedSpecies: [],
      message: '一个化学式只有物质组成，不能唯一确定分子键结构、反应物和产物，因此不能生成“反应动画”。请补充完整反应方程或具体反应名称。'
    };
    return {status: 'needs_reaction', courseKey: null, unsupportedSpecies: [], message: '请提供完整反应方程，或明确反应物、产物与反应条件。'};
  }
  const [left, right = ''] = compact.split(arrow[1]);
  const reactants = speciesFromSide(left.replace(/^.*?[:：]/, ''));
  const products = speciesFromSide(right.replace(/[（(].*$/, ''));
  const all = [...reactants, ...products];
  const unsupportedSpecies = [...new Set(all.filter(item => !KNOWN_SPECIES.has(item)))];
  const match = [
    {key:'combustion_ch4', r:['CH4','O2'], p:['CO2','H2O']},
    {key:'combustion_h2', r:['H2','O2'], p:['H2O']},
    {key:'electrolysis_water', r:['H2O'], p:['H2','O2']},
    {key:'redox_na_cl2', r:['Na','Cl2'], p:['NaCl']},
    {key:'glucose_combustion', r:['C6H12O6','O2'], p:['CO2','H2O']}
  ].find(item => sameSet(reactants,item.r) && sameSet(products,item.p));
  if (match) return {status:'supported_reaction',courseKey:match.key,reactants,products,unsupportedSpecies:[],message:'反应物、产物和原子映射均有已校验模型，可生成真实互动动画。'};
  return {
    status:'unsupported_reaction', courseKey:null, reactants, products, unsupportedSpecies,
    message: unsupportedSpecies.length
      ? `当前分子几何库还没有 ${unsupportedSpecies.join('、')} 的可靠键结构与原子映射，不能用别的反应动画代替。`
      : '这些物种已能识别，但当前还没有为该反应建立守恒的原子映射和断键/成键路径。'
  };
}
