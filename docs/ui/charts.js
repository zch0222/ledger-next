/* Design prototype: Apache ECharts 6.0.0, local assets, no financial service calls. */
(() => {
  'use strict';
  const instances = new Map();
  const motion = window.matchMedia('(prefers-reduced-motion: reduce)');
  const escape = value => String(value).replace(/[&<>"']/g, c => ({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
  let currentModel;
  let currentActions;

  // Theme tokens may be var() / color-mix() expressions; resolve them to #rrggbb because ECharts appends alpha to hex values.
  function resolveColor(probe, key) {
    probe.style.color = 'var(--' + key + ')';
    const value = getComputedStyle(probe).color;
    const rgb = value.match(/^rgba?\(([^)]+)\)/)?.[1].split(/[\s,/]+/).slice(0, 3).map(Number)
      ?? value.match(/^color\(srgb\s+([^)]+)\)/)?.[1].trim().split(/\s+/).slice(0, 3).map(v => Number(v) * 255);
    return rgb ? '#' + rgb.map(v => Math.round(Math.min(255, Math.max(0, v))).toString(16).padStart(2, '0')).join('') : value;
  }
  function palette() {
    const probe = document.createElement('span');
    probe.hidden = true;
    document.body.append(probe);
    const token = key => resolveColor(probe, key);
    const categories=Object.fromEntries(Object.entries({居住:'home',购物:'shopping',订阅服务:'subscription',交通:'travel',餐饮:'food',工资:'food'}).map(([name,key])=>[name,token('cat-'+key)]));
    const colors={ink:token('ink'),muted:token('muted'),line:token('line'),surface:token('panel'),accent:token('accent'),positive:token('positive'),blue:token('blue'),soft:token('soft'),categories};
    probe.remove();
    return colors;
  }
  function money(value) {
    return new Intl.NumberFormat('zh-CN', {style:'currency',currency:currentModel.currency,currencyDisplay:'narrowSymbol',minimumFractionDigits:2}).format(value);
  }
  function tooltip(p) {
    const rows = Array.isArray(p) ? p : [p];
    return rows.map(r => '<div style="display:flex;gap:20px;justify-content:space-between"><span>'+escape(r.seriesName==='分类'||r.seriesType==='pie'?r.name:r.seriesName)+'</span><strong>'+escape(money(Number(r.value)))+'</strong></div>').join('');
  }
  function baseOption(colors) {
    return {
      animation:!motion.matches,
      animationDuration:window.innerWidth<768?550:750,
      animationDurationUpdate:motion.matches?0:420,
      animationEasing:'cubicOut',
      animationEasingUpdate:'cubicInOut',
      animationThreshold:366,
      textStyle:{fontFamily:'"Microsoft YaHei","PingFang SC",sans-serif',color:colors.ink},
      aria:{enabled:true},
      tooltip:{trigger:'item',confine:true,backgroundColor:colors.surface,borderColor:colors.line,borderWidth:1,padding:[12,16],textStyle:{color:colors.ink,fontSize:12},extraCssText:'border-radius:12px;box-shadow:0 12px 28px #102d301a;',transitionDuration:motion.matches?0:.15,formatter:tooltip}
    };
  }
  function options(type, dom) {
    const model=currentModel, c=palette(), factor=model.rates[model.currency];
    const option=baseOption(c);
    if(type==='trend'){
      const compare=model.trendMode==='compare';
      const weeks=model.weeks;
      const data=kind=>weeks.map(w=>({name:w.label,value:Number((w[kind]/factor).toFixed(2))}));
      return {...option,
        aria:{enabled:true,label:{description:'九月每周'+(compare?'收入与支出':'支出')+'，单位 '+model.currency+'。下方有可访问数据表。'}},
        grid:{top:26,right:18,bottom:34,left:62},
        tooltip:{...option.tooltip,trigger:'axis',axisPointer:{type:compare?'shadow':'line',lineStyle:{color:c.line,type:'dashed'}}},
        xAxis:{type:'category',boundaryGap:compare,data:weeks.map(w=>w.label),axisLine:{show:false},axisTick:{show:false},axisLabel:{color:c.muted,fontSize:12,margin:14,formatter:(v,i)=>dom.clientWidth<400?'第'+(i+1)+'周':v}},
        yAxis:{type:'value',min:0,splitNumber:3,axisLabel:{color:c.muted,fontSize:12,formatter:v=>v.toLocaleString('zh-CN')},splitLine:{lineStyle:{color:c.line,type:'dashed'}}},
        series:[
          {id:'expense',name:'支出',type:compare?'bar':'line',data:data('expense'),smooth:.2,smoothMonotone:'x',showSymbol:false,symbol:'circle',symbolSize:8,barMaxWidth:23,
            itemStyle:{color:c.blue,borderRadius:[6,6,0,0]},lineStyle:{width:3,color:c.blue},
            areaStyle:{color:new echarts.graphic.LinearGradient(0,0,0,1,[{offset:0,color:c.blue+'42'},{offset:1,color:c.blue+'02'}])},
            emphasis:{focus:'series',scale:true},animationDelay:i=>motion.matches?0:Math.min(i*45,180)},
          {id:'income',name:'收入',type:'bar',data:compare?data('income'):[],barMaxWidth:23,itemStyle:{color:c.positive,borderRadius:[6,6,0,0]},emphasis:{focus:'series'},animationDelay:i=>motion.matches?0:Math.min(i*45+60,180)}
        ]
      };
    }
    if(type==='categories'){
      const data=model.categories;
      return {...option,
        aria:{enabled:true,label:{description:'支出分类排行，单位 '+model.currency+'。点击分类可查询明细，下方提供键盘可访问的明细按钮。'}},
        grid:{left:70,right:82,top:8,bottom:8},
        xAxis:{type:'value',show:false,max:v=>v.max>0?v.max*1.02:1},
        yAxis:{type:'category',inverse:true,data:data.map(d=>d[0]),axisLine:{show:false},axisTick:{show:false},axisLabel:{color:c.ink,fontSize:12}},
        series:[{id:'categories',name:'分类',type:'bar',barWidth:10,showBackground:true,backgroundStyle:{color:c.soft,borderRadius:6},label:{show:true,position:'right',distance:10,color:c.ink,fontSize:12,formatter:p=>money(p.value)},itemStyle:{borderRadius:6},data:data.map(([name,value])=>({name,value:Number((value/factor).toFixed(2)),itemStyle:{color:c.categories[name]||c.muted}})),emphasis:{focus:'self'},animationDelay:i=>motion.matches?0:Math.min(i*50,180)}]
      };
    }
    return {...option,
      aria:{enabled:true,label:{description:'按历史入账口径的支出占比，各分类金额可从下方数据列表查看。'}},
      title:{text:money(model.categories.reduce((s,d)=>s+d[1],0)/factor),subtext:'九月总支出 · '+model.currency,left:'center',top:'40%',itemGap:8,textStyle:{color:c.ink,fontSize:dom.clientWidth<340?21:25,fontWeight:600},subtextStyle:{color:c.muted,fontSize:12}},
      series:[{id:'composition',name:'支出构成',type:'pie',radius:['65%','84%'],center:['50%','49%'],startAngle:90,padAngle:3,minAngle:0,avoidLabelOverlap:true,label:{show:false},labelLine:{show:false},itemStyle:{borderRadius:7},animationType:'expansion',animationDuration:motion.matches?0:850,animationDurationUpdate:motion.matches?0:420,emphasis:{scale:true,scaleSize:5},data:model.categories.map(([name,value])=>({name,value:Number((value/factor).toFixed(2)),itemStyle:{color:c.categories[name]||c.muted}}))}]
    };
  }
  function apply(record) {
    record.chart.setOption(options(record.dom.dataset.chart,record.dom),{notMerge:false,lazyUpdate:false});
  }
  function sync(scope, model, actions) {
    currentModel=model;
    currentActions=actions;
    for(const [dom, record] of instances) {
      if(!scope.contains(dom)) {
        record.observer.disconnect();
        record.chart.dispose();
        instances.delete(dom);
      }
    }
    for(const dom of scope.querySelectorAll('[data-chart]')) {
      if(!window.echarts) {
        dom.textContent='图表资源不可用，请查看下方数据。';
        dom.nextElementSibling?.setAttribute('open','');
        continue;
      }
      let record=instances.get(dom);
      if(!record) {
        const chart=echarts.init(dom,null,{renderer:'svg'});
        const observer=new ResizeObserver(()=>{if(dom.isConnected)chart.resize({animation:{duration:0}});});
        record={dom,chart,observer};
        instances.set(dom,record);
        observer.observe(dom);
        chart.on('click',p=>{
          if(dom.dataset.chart==='trend')currentActions.selectWeek(p.dataIndex);
          else if(p.name)currentActions.selectCategory(p.name);
        });
      }
      apply(record);
    }
  }
  motion.addEventListener('change',()=>{for(const record of instances.values())apply(record);});
  window.addEventListener('pagehide',()=>{for(const record of instances.values()){record.observer.disconnect();record.chart.dispose();}instances.clear();});
  window.addEventListener('pageshow',e=>{if(e.persisted&&currentModel)sync(document.getElementById('content'),currentModel,currentActions);});
  window.LedgerCharts={sync};
})();
