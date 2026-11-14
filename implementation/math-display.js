/* Normalize the common undelimited LaTeX fragments emitted by tutor models.
   Kept independent of KaTeX so this behavior can be regression-tested without a browser. */
(function (root) {
  'use strict';

  var delimiters = /(\$\$[\s\S]*?\$\$|\$[^$\n]*?\$|\\\[[\s\S]*?\\\]|\\\([\s\S]*?\\\))/g;
  var bareCommand = /(\\(?:frac|dfrac|tfrac|sqrt|root|overline|underline|overrightarrow|overleftarrow|widehat|vec|hat|bar|cdot|times|pm|mp|leq?|geq?|neq|approx|sim|cong|theta|alpha|beta|gamma|delta|epsilon|lambda|mu|omega|phi|varphi|pi|rho|sin|cos|tan|cot|log|ln|lim|sum|prod|int|partial|nabla|angle|perp|parallel|infty|Delta|Rightarrow|Longrightarrow|iff|in|notin|subseteq|supseteq|therefore|forall|exists|mathrm|mathbf|mathbb|mathcal|mathsf|operatorname|text)\b)([A-Za-z0-9{}_^=+\-*\/(),.\[\]|\\\s×÷≤≥≠∥⊥∠θπ₀₁₂₃₄₅₆₇₈₉]*)/g;
  var coordinate = /\b([A-Z])\s*\(\s*([xyz])_\{?(\d+)\}?\s*,\s*([xyz])_\{?(\d+)\}?\s*,\s*([xyz])_\{?(\d+)\}?\s*\)/g;

  function balanced(source) {
    var depth = 0;
    for (var i = 0; i < source.length; i += 1) {
      if (source[i] === '{') depth += 1;
      if (source[i] === '}') depth -= 1;
      if (depth < 0) return false;
    }
    return depth === 0;
  }

  function collapseRepeatedPointLabel(source) {
    return source.replace(/([\u{1D434}-\u{1D44D}])\s*\(\s*([A-Z])\s*(\([^()]*\))\s*\)/gu, function (whole, italic, plain, coordinates) {
      var ascii = String.fromCharCode(65 + italic.codePointAt(0) - 0x1D434);
      if (ascii !== plain) return whole;
      return plain + coordinates.replace(/,\s*,/g, ',').replace(/\s*,\s*/g, ',').replace(/\s+/g, '');
    });
  }

  function wrapBareLatex(value) {
    var text = String(value == null ? '' : value);
    return text.split(delimiters).map(function (part, index) {
      if (index % 2 === 1) return part;
      var normalized = collapseRepeatedPointLabel(part);
      var formatted = normalized.replace(coordinate, function (_, name, x, xi, y, yi, z, zi) {
        return '$' + name + '(' + x + '_{' + xi + '},' + y + '_{' + yi + '},' + z + '_{' + zi + '})$';
      });
      return formatted.replace(bareCommand, function (whole, command) {
        var expression = whole.trim();
        return balanced(expression) ? '$' + expression + '$' : whole;
      });
    }).join('');
  }

  root.EduMathDisplay = Object.freeze({wrapBareLatex: wrapBareLatex});
})(typeof window === 'undefined' ? globalThis : window);
