// Local survey coordinates in metres; depth is positive down from the survey datum.
export function demoSeabed() {
  const columns = 97, rows = 73, points = [];
  for (let j = 0; j < rows; j++) for (let i = 0; i < columns; i++) {
    const x = i * 120 / (columns - 1), y = j * 90 / (rows - 1);
    const ridge = 15 * Math.exp(-((x - 42 - 12 * Math.sin(y / 24)) ** 2 / 230 + (y - 40) ** 2 / 1700));
    const mound = 10 * Math.exp(-((x - 91) ** 2 / 280 + (y - 67) ** 2 / 200));
    const channel = 6 * Math.exp(-((x - 77 + 9 * Math.sin(y / 18)) ** 2 / 65));
    const depth = 31 - ridge - mound + channel + 1.1 * Math.sin(x / 6 + y / 14) + .65 * Math.cos(y / 4 - x / 12);
    points.push({ x, y, depth });
  }
  return { name: 'Coastal ridge', source: 'demo', points, columns, rows };
}

export function surveyStats(points) {
  let minX=Infinity,maxX=-Infinity,minY=Infinity,maxY=-Infinity,minDepth=Infinity,maxDepth=-Infinity;
  for (const p of points) {
    minX=Math.min(minX,p.x);maxX=Math.max(maxX,p.x);minY=Math.min(minY,p.y);maxY=Math.max(maxY,p.y);
    minDepth=Math.min(minDepth,p.depth);maxDepth=Math.max(maxDepth,p.depth);
  }
  return { minX,maxX,minY,maxY,minDepth,maxDepth,width:maxX-minX,length:maxY-minY,count:points.length };
}

export function parseSurveyCsv(text, name='Survey points') {
  const lines=text.replace(/^\uFEFF/,'').trim().split(/\r?\n/).filter(line=>line.trim());
  const headers=lines.shift()?.split(',').map(h=>h.trim().toLowerCase()) || [];
  const keys=['x_m','y_m','depth_m'].map(k=>headers.indexOf(k));
  if(keys.some(k=>k<0)) throw new Error('Use CSV columns x_m, y_m, depth_m. Coordinates and positive-down depth must be in metres.');
  if(lines.length<3 || lines.length>20000) throw new Error('Import between 3 and 20,000 survey points.');
  const points=lines.map((line,i)=>{
    const cells=line.split(',');
    const values=keys.map(k=>cells[k]?.trim());
    if(values.some(v=>v===undefined||v==='')) throw new Error(`Row ${i+2}: a coordinate or depth is missing.`);
    const [x,y,depth]=values.map(Number);
    if(![x,y,depth].every(Number.isFinite)||depth<0||[x,y,depth].some(v=>Math.abs(v)>1e8)) throw new Error(`Row ${i+2}: use finite metre values and nonnegative depth.`);
    return {x,y,depth};
  });
  const s=surveyStats(points);
  if(Math.max(s.width,s.length)<.001) throw new Error('The points need different horizontal positions.');
  return {name,source:'imported',points};
}
