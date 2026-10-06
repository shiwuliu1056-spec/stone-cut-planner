const overview = require('../../shared/claim/home');

Component({
  properties: { active: { type: Boolean, value: false } },
  data: overview.data,
  lifetimes: { attached() { this.refresh(); } },
  observers: { active(value) { if (value) this.refresh(); } },
  pageLifetimes: { show() { if (this.properties.active) this.refresh(true); } },
  methods: {
    ...overview.methods,
    backToToolbox() { this.triggerEvent('back'); },
  },
});
