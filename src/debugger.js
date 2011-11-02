function PdfDebugger () {
  this.popup;
  this.doc;
  this.len;
  this.breakPoint = 0;
  this.nextBreakPoint = null;
  if(sessionStorage.getItem("pdfjsBreakPoints"))
    this.breakPoints = JSON.parse(sessionStorage.getItem("pdfjsBreakPoints"));
  else
    this.breakPoints =  [];
  this.currentIdx = 0;
}
PdfDebugger.prototype = {
  showPopup: function(IRQueue) {
    this.len = IRQueue.fnArray.length;
    var content = '<strong>c=contine, s=step</strong><table cellspacing="0"><tr><th>Break</th><th>Idx</th><th>Fn</th><th>Args</th></tr>';
    for (var i = 0; i < IRQueue.fnArray.length; i++) {
      content += '<tr class="line" id="idx' + i + '">';
      var checked = '';
      if (this.breakPoints.indexOf(i) != -1)
        checked = ' checked';
      content += '<td><input type="checkbox" class="points" id="idxC' + i + '"' + checked + '/></td>' +
        '<td>' + i + '</td>' +
        '<td>' + IRQueue.fnArray[i] + ' </td>' +
        '<td>' + IRQueue.argsArray[i].join(', ') + '</td>' +
      '</tr>';
    }
    content += '</table>';
    var popup = window.open("","window","scrollbars=yes,resizeable=yes,width=400,height=300");
    popup.document.write(content);
    this.popup = popup;
    this.doc = popup.document;
    this.doc.innerHTML = '';
    var allRows = this.doc.getElementsByClassName('points');
    var self = this;
    for (var x = 0; x < allRows.length; x++) {
      allRows[x].onclick = (function(x) {
        return function() { 
          if (this.checked) {
            self.breakPoints.push(x); 
          } else {
            self.breakPoints.splice(self.breakPoints.indexOf(x), 1);
          }
          sessionStorage.setItem("pdfjsBreakPoints", JSON.stringify(self.breakPoints));
        }
      })(x);
    }
    window.onunload = function() {
      self.popup.close();
    }
  },
  getNextBreakPoint: function() {
    this.breakPoints.sort(function(a, b) { return a - b; });
    for (var i = 0; i < this.breakPoints.length; i++) {
      if (this.breakPoints[i] > this.currentIdx)
        return this.breakPoints[i];
    }
    return null;
  },
  breakIt: function(idx, gfx, callback) {
    var self = this;
    self.currentIdx = idx;
    self.popup.onkeydown = function(e) {
      self.popup.onkeydown = function() { };
      gfx.onBreakPoint = false;
      switch (e.keyCode) {
        case 83: // step
          callback(self.currentIdx + 1);
          break;
        case 67: // continue
          var breakPoint = self.getNextBreakPoint();
          callback(breakPoint);
          self.goTo(breakPoint);
          break;
      }
    }
    self.goTo(idx);
  },
  goTo: function(idx) {
    var allRows = this.doc.getElementsByClassName('line');
    for (var x = 0; x < allRows.length; x++) {
      allRows[x].style.backgroundColor = null;
    }
    var row = this.doc.getElementById('idx' + idx);
    if (row) {
      row.style.backgroundColor = 'rgb(251,250,207)';
      row.scrollIntoView();
    }
  }
};