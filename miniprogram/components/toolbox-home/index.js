Component({
  data: {
    tools: [
      { id: 'cut', number: '01', name: '石材下料', description: '录入尺寸，生成材料排版图', image: '/assets/toolbox/cut.svg' },
      { id: 'watermark', number: '02', name: '视频去水印', description: '解析视频，提取语音文案', image: '/assets/toolbox/watermark.svg' },
      { id: 'claim', number: '03', name: '起诉助手', description: '填写案件信息，生成起诉材料', scope: '九江 · 买卖合同纠纷', image: '/assets/toolbox/claim.svg' },
    ],
  },
  methods: {
    selectTool(event) {
      this.triggerEvent('toolselect', { tool: event.currentTarget.dataset.tool });
    },
  },
});
