(function(){
  window.__grade10ExampleLibraryLoaded=true;
  'use strict';

  var app=null;
  var examples=[
    {
      title:'正方体选择题基础模型',
      unit:'空间几何',
      question:'在正方体 ABCD-A1B1C1D1 中，棱长为 1，动点 E 在线段 A1C1 上，F、M 分别是 AB、CD 的中点，逐项判断题目给出的空间关系。',
      answer:'我会先观察正方体基础模型，再为每个选项分别添加需要的辅助线并验证。'
    },
    {
      title:'圆柱体积与表面积',
      unit:'立体几何初步',
      question:'圆柱的底面半径为 $3$，高为 $4$。求这个圆柱的体积与表面积。',
      answer:'我会先分别写出体积公式和表面积公式，再代入半径与高。'
    },
    {
      title:'圆锥的母线关系',
      unit:'立体几何初步',
      question:'圆锥的底面半径为 $3$，高为 $4$，母线长为 $5$。求圆锥的体积与表面积。',
      answer:'我准备利用半径、高和母线组成的直角三角形，并分别计算底面积与侧面积。'
    },
    {
      title:'球的平面截面',
      unit:'立体几何初步',
      question:'半径为 $5$ 的球被一个平面所截，球心到截平面的距离为 $3$。求截面圆的半径与面积。',
      answer:'我准备连接球心与截面圆心，用勾股定理求截面圆半径。'
    },
    {
      title:'正四棱锥的高与侧棱',
      unit:'空间几何',
      question:'正四棱锥 $P-ABCD$ 的底面边长为 $6$，高 $PO=4$，$O$ 为正方形 $ABCD$ 的中心。求侧棱 $PA$ 的长度。',
      answer:'我准备先求底面中心到顶点的距离 $OA$，再在直角三角形 $POA$ 中计算。'
    }
  ];

  function esc(value){return app.esc(String(value==null?'':value))}

  function submitThroughNativeUpload(example){
    app.state.geometryTextQuestion=example.question;
    app.state.geometryTextAnswer=example.answer;
    app.state.tab='upload';
    app.save();
    app.render();
    window.setTimeout(function(){
      var submit=document.querySelector('#analyze-text-question');
      if(submit)submit.click();
    },0);
  }

  function card(example,index){
    return '<article class="card grade10-upload-example">'
      +'<span class="pill good">可生成 3D</span><span class="pill">'+esc(example.unit)+'</span>'
      +'<h3>'+esc(example.title)+'</h3>'
      +'<p class="math">'+esc(example.question)+'</p>'
      +'<button class="primary" data-g10-native-upload="'+index+'">模拟真实上传</button>'
      +'</article>';
  }

  var feature={
    activate:function(context){app=context},
    decorateUpload:function(root){
      if(root.querySelector('.grade10-upload-examples'))return;
      root.insertAdjacentHTML('beforeend','<section class="panel grade10-upload-examples">'
        +'<div class="head"><div><span class="pill good">真实上传示范</span>'
        +'<h2>选择一道可建模例题</h2>'
        +'<p class="muted">点击后只会把题目填入当前上传页，并调用与学生上传完全相同的解析、后台复核、3D 建模和错题入库流程。</p>'
        +'</div></div><div class="work">'+examples.map(card).join('')+'</div></section>');
      root.querySelectorAll('[data-g10-native-upload]').forEach(function(button){
        button.onclick=function(){
          var example=examples[Number(button.dataset.g10NativeUpload)];
          if(example)submitThroughNativeUpload(example);
        };
      });
    }
  };

  if(window.__registerGrade10ExampleLibrary)window.__registerGrade10ExampleLibrary(feature);
}());
