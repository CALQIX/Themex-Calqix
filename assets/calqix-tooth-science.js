(() => {
  const ROOT_SELECTOR = '[data-ts-root]';
  const MOBILE_BREAKPOINT = 750;
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

  const LAYERS = {
    overview: { label: 'Tooth overview', kicker: 'Tooth overview' },
    enamel: { label: 'Enamel', kicker: 'Protective outer shield' },
    dentin: { label: 'Dentin', kicker: 'Supportive inner structure' },
    pulp: { label: 'Pulp', kicker: 'Vital living center' },
    root: { label: 'Root', kicker: 'Tooth anchor' },
    gum: { label: 'Gum', kicker: 'Soft tissue seal' },
    cementum: { label: 'Cementum', kicker: 'Root coating' },
    rootCanal: { label: 'Root canal', kicker: 'Internal pathway' },
    alveolarBone: { label: 'Alveolar bone', kicker: 'Jaw support system' },
    periodontalLigament: { label: 'Ligament', kicker: 'Shock absorber' }
  };

  const TEETH = {
    incisors: {
      label: 'Incisors', role: 'cut food cleanly and support speech', surface: 'front biting edge',
      care: 'gentle gumline cleaning and acid control', risk: 'edge wear, translucency, and recession',
      overviewTitle: 'Built for the first bite.',
      overview: 'Incisors sit at the front of the mouth and are shaped to slice into food, guide pronunciation, and frame the smile.',
      functionProfile: ['Slice food cleanly', 'Guide speech sounds', 'Frame the smile'],
      careProfile: ['Protect the edge from acids', 'Clean gently at the gumline', 'Avoid harsh horizontal scrubbing'],
      riskTitle: 'Thin edges show wear early',
      riskCopy: 'Because incisors are thin and highly visible, enamel loss, chips, and recession usually become noticeable here first.',
      factYoung: 'Young incisors have relatively larger pulps and shorter roots, so trauma can reach the living center sooner.',
      factAdult: 'Adult incisors prioritise precision over power, which is why erosion or grinding can visibly thin the edge over time.',
      anatomy: {
        adult: { crownWidth: 116, crownHeight: 124, shouldersY: 166, rootCount: 1, rootLength: 214, rootSpread: 0, cusps: [10, 4, 10], taper: 28 },
        young: { crownWidth: 108, crownHeight: 110, shouldersY: 175, rootCount: 1, rootLength: 170, rootSpread: 0, cusps: [8, 4, 8], taper: 24 }
      },
      hotspots: { enamel: [50, 18, 'top'], dentin: [40, 33, 'left'], pulp: [51, 42, 'right'], root: [57, 67, 'right'], gum: [75, 46, 'right'], cementum: [36, 58, 'left'], rootCanal: [50, 55, 'bottom'], alveolarBone: [81, 71, 'right'], periodontalLigament: [30, 68, 'left'] }
    },
    canines: {
      label: 'Canines', role: 'grip, tear, and guide side movement', surface: 'pointed canine cusp',
      care: 'protect against grinding and support the gum collar', risk: 'cusp wear, overload, and recession',
      overviewTitle: 'The pointed stabilisers of the bite.',
      overview: 'Canines are long-rooted teeth built to grip, tear, and guide the jaw during sideways chewing movement.',
      functionProfile: ['Grip and tear food', 'Guide side movement', 'Stabilise the bite'],
      careProfile: ['Protect the cusp from grinding', 'Keep the gum collar calm', 'Clean around the long root zone'],
      riskTitle: 'Guidance forces build here',
      riskCopy: 'Because canines help steer the bite, wear facets and gum recession can develop slowly if overload or inflammation persists.',
      factYoung: 'Young canines may look sharp and strong, but their deep support tissues are still maturing.',
      factAdult: 'Adult canines usually have some of the longest roots in the mouth, helping them guide movement with stability.',
      anatomy: {
        adult: { crownWidth: 108, crownHeight: 138, shouldersY: 168, rootCount: 1, rootLength: 206, rootSpread: 0, cusps: [22, 0, 22], taper: 24 },
        young: { crownWidth: 100, crownHeight: 124, shouldersY: 175, rootCount: 1, rootLength: 172, rootSpread: 0, cusps: [18, 0, 18], taper: 22 }
      },
      hotspots: { enamel: [50, 17, 'top'], dentin: [41, 32, 'left'], pulp: [51, 40, 'right'], root: [57, 65, 'right'], gum: [74, 44, 'right'], cementum: [37, 57, 'left'], rootCanal: [50, 54, 'bottom'], alveolarBone: [80, 69, 'right'], periodontalLigament: [31, 66, 'left'] }
    },
    premolars: {
      label: 'Premolars', role: 'crush food and bridge front-to-back chewing', surface: 'dual-cusp chewing ridge',
      care: 'clean grooves, sides, and the gumline carefully', risk: 'hidden plaque and cusp flattening',
      overviewTitle: 'The transition teeth between cutting and grinding.',
      overview: 'Premolars bridge front and back function by tearing, crushing, and moving food toward the stronger molars.',
      functionProfile: ['Crush food efficiently', 'Bridge front and back chewing', 'Balance force across the bite'],
      careProfile: ['Clean grooves and sides', 'Support gumline health', 'Protect chewing ridges'],
      riskTitle: 'Grooves can hide trouble',
      riskCopy: 'Premolars often look simple from the front, but their chewing anatomy can trap plaque and wear more quietly than expected.',
      factYoung: 'Newly erupted premolars can catch plaque quickly before brushing habits adapt to their chewing anatomy.',
      factAdult: 'Adult premolars often work harder than people expect because they sit in the transition zone of the bite.',
      anatomy: {
        adult: { crownWidth: 118, crownHeight: 126, shouldersY: 170, rootCount: 1, rootLength: 198, rootSpread: 0, cusps: [12, 2, 16], taper: 26 },
        young: { crownWidth: 110, crownHeight: 114, shouldersY: 177, rootCount: 1, rootLength: 166, rootSpread: 0, cusps: [10, 2, 14], taper: 24 }
      },
      hotspots: { enamel: [50, 18, 'top'], dentin: [40, 34, 'left'], pulp: [50, 41, 'right'], root: [57, 66, 'right'], gum: [75, 45, 'right'], cementum: [38, 57, 'left'], rootCanal: [50, 54, 'bottom'], alveolarBone: [81, 70, 'right'], periodontalLigament: [31, 67, 'left'] }
    },
    molars: {
      label: 'Molars', role: 'grind food under heavier bite force', surface: 'broad grinding table',
      care: 'reach deep grooves and back-of-mouth gumlines daily', risk: 'hidden plaque, cracks, and gum inflammation',
      overviewTitle: 'The powerhouses built for grinding.',
      overview: 'Molars have broad chewing surfaces, multiple cusps, and strong roots designed to grind food efficiently and absorb heavier forces.',
      functionProfile: ['Grind food thoroughly', 'Absorb heavier bite forces', 'Support chewing efficiency'],
      careProfile: ['Clean deep grooves daily', 'Target back-of-mouth plaque', 'Support roots and surrounding gums'],
      riskTitle: 'Back teeth hide problems longer',
      riskCopy: 'Molars are powerful, but their position makes them easier to neglect and harder to inspect around grooves and gum margins.',
      factYoung: 'Young molars can be hard to clean because they erupt into fresh grooves before technique has adapted to them.',
      factAdult: 'Adult molars do most of the chewing work, which makes prevention especially valuable even when nothing feels wrong.',
      anatomy: {
        adult: { crownWidth: 156, crownHeight: 122, shouldersY: 170, rootCount: 3, rootLength: 188, rootSpread: 54, cusps: [16, 6, 12, 4, 14], taper: 24 },
        young: { crownWidth: 146, crownHeight: 110, shouldersY: 176, rootCount: 3, rootLength: 156, rootSpread: 48, cusps: [14, 6, 10, 4, 12], taper: 22 }
      },
      hotspots: { enamel: [50, 18, 'top'], dentin: [39, 35, 'left'], pulp: [50, 41, 'bottom'], root: [63, 67, 'right'], gum: [79, 44, 'right'], cementum: [33, 59, 'left'], rootCanal: [50, 57, 'bottom'], alveolarBone: [85, 71, 'right'], periodontalLigament: [28, 68, 'left'] }
    },
    wisdom: {
      label: 'Wisdom teeth', role: 'add late-stage grinding support when space allows', surface: 'late-erupting back crown',
      care: 'flush and clean partially erupted areas carefully', risk: 'partial eruption, tissue trapping, and awkward access',
      overviewTitle: 'The unpredictable latecomers.',
      overview: 'Wisdom teeth are third molars that often erupt later, sometimes partially, at angles, or with limited space.',
      functionProfile: ['Potential extra grinding surface', 'Late eruption pattern', 'Higher hygiene challenge'],
      careProfile: ['Keep the back-most gumline clean', 'Watch eruption changes', 'Act early on repeated irritation'],
      riskTitle: 'Position matters more than size',
      riskCopy: 'A wisdom tooth may be healthy in structure but still problematic if it erupts partially, tilts, or traps plaque against tissue.',
      factYoung: 'Back-of-mouth eruption can create cleaning challenges before the tooth ever contributes much function.',
      factAdult: 'A fully formed wisdom tooth does not always become a fully useful tooth because position can limit its role.',
      anatomy: {
        adult: { crownWidth: 146, crownHeight: 118, shouldersY: 172, rootCount: 3, rootLength: 180, rootSpread: 46, cusps: [18, 8, 16, 6, 20], taper: 26 },
        young: { crownWidth: 136, crownHeight: 106, shouldersY: 178, rootCount: 3, rootLength: 150, rootSpread: 40, cusps: [16, 8, 14, 6, 18], taper: 24 }
      },
      hotspots: { enamel: [50, 18, 'top'], dentin: [39, 35, 'left'], pulp: [50, 41, 'bottom'], root: [62, 67, 'right'], gum: [79, 44, 'right'], cementum: [34, 58, 'left'], rootCanal: [50, 56, 'bottom'], alveolarBone: [84, 70, 'right'], periodontalLigament: [29, 67, 'left'] }
    }
  };

  function buildCurve(points, startY, endY) {
    const width = points.length - 1;
    let d = `M ${points[0][0]} ${startY}`;
    d += ` C ${points[0][0]} ${startY - 24}, ${points[1][0] - 16} ${points[1][1]}, ${points[1][0]} ${points[1][1]}`;
    for (let index = 1; index < points.length - 1; index += 1) {
      const current = points[index];
      const next = points[index + 1];
      const ctrl = (next[0] - current[0]) / 2;
      d += ` C ${current[0] + ctrl} ${current[1]}, ${next[0] - ctrl} ${next[1]}, ${next[0]} ${next[1]}`;
    }
    d += ` C ${points[width][0]} ${startY - 24}, ${points[width][0]} ${endY}, ${points[width][0]} ${endY}`;
    return d;
  }

  function getToothGeometry(toothKey, ageMode) {
    const config = TEETH[toothKey].anatomy[ageMode];
    const centerX = 166;
    const topY = 44;
    const half = config.crownWidth / 2;
    const leftX = centerX - half;
    const rightX = centerX + half;
    const topPoints = config.cusps.map((value, index, arr) => {
      const ratio = index / (arr.length - 1);
      return [leftX + config.crownWidth * ratio, topY + value];
    });
    const crownOuter = `${buildCurve(topPoints, config.shouldersY, config.shouldersY)} Q ${centerX} ${config.shouldersY + 12} ${leftX} ${config.shouldersY} Z`;
    const inset = 12;
    const innerPoints = topPoints.map(([x, y], index, arr) => {
      const ratio = index / (arr.length - 1);
      const shift = index === 0 || index === arr.length - 1 ? inset + 4 : inset;
      return [leftX + shift + (config.crownWidth - shift * 2) * ratio, y + 12];
    });
    const crownInner = `${buildCurve(innerPoints, config.shouldersY - 10, config.shouldersY - 10)} Q ${centerX} ${config.shouldersY - 2} ${innerPoints[0][0]} ${config.shouldersY - 10} Z`;
    const pulpPoints = innerPoints.map(([x, y], index) => [x, y + (index % 2 === 0 ? 14 : 10)]);
    const pulp = `${buildCurve(pulpPoints, config.shouldersY - 18, config.shouldersY - 18)} Q ${centerX} ${config.shouldersY + 10} ${pulpPoints[0][0]} ${config.shouldersY - 18} Z`;

    const roots = [];
    const canalLines = [];
    const ligament = [];
    const cementum = [];
    const count = config.rootCount;
    const spread = count === 1 ? 0 : config.rootSpread;

    for (let index = 0; index < count; index += 1) {
      const ratio = count === 1 ? 0.5 : index / (count - 1);
      const startX = centerX + (ratio - 0.5) * spread;
      const topLeft = startX - config.taper / 2;
      const topRight = startX + config.taper / 2;
      const tipX = startX + (ratio - 0.5) * 12;
      const tipY = config.shouldersY + config.rootLength;
      const root = `M ${topLeft} ${config.shouldersY - 4} C ${topLeft - 8} ${config.shouldersY + 60}, ${tipX - 12} ${tipY - 38}, ${tipX} ${tipY} C ${tipX + 12} ${tipY - 38}, ${topRight + 8} ${config.shouldersY + 60}, ${topRight} ${config.shouldersY - 4} Z`;
      roots.push(root);
      ligament.push(`M ${topLeft + 5} ${config.shouldersY + 2} C ${topLeft - 1} ${config.shouldersY + 56}, ${tipX - 8} ${tipY - 40}, ${tipX - 1} ${tipY - 4}`);
      ligament.push(`M ${topRight - 5} ${config.shouldersY + 2} C ${topRight + 1} ${config.shouldersY + 56}, ${tipX + 8} ${tipY - 40}, ${tipX + 1} ${tipY - 4}`);
      cementum.push(`M ${startX} ${config.shouldersY + 8} C ${startX + (ratio - 0.5) * 5} ${config.shouldersY + 74}, ${tipX} ${tipY - 48}, ${tipX} ${tipY - 10}`);
      canalLines.push(`M ${startX} ${config.shouldersY - 24} C ${startX} ${config.shouldersY + 42}, ${tipX} ${tipY - 70}, ${tipX} ${tipY - 18}`);
    }

    const gumY = config.shouldersY - 2;
    const gum = `M 44 ${gumY + 24} C 82 ${gumY + 4}, 114 ${gumY - 4}, 152 ${gumY - 4} H 180 C 218 ${gumY - 4}, 250 ${gumY + 4}, 288 ${gumY + 24} C 277 ${gumY + 36}, 258 ${gumY + 42}, 232 ${gumY + 43} H 100 C 74 ${gumY + 42}, 55 ${gumY + 36}, 44 ${gumY + 24} Z`;
    const bone = `M 28 ${gumY + 34} C 62 ${gumY + 56}, 102 ${gumY + 66}, 144 ${gumY + 68} H 188 C 230 ${gumY + 66}, 270 ${gumY + 56}, 304 ${gumY + 34} V 372 C 272 ${gumY + 94}, 230 ${gumY + 106}, 188 ${gumY + 108} H 144 C 102 ${gumY + 106}, 60 ${gumY + 94}, 28 ${gumY + 72} Z`;
    const outline = `${buildCurve(topPoints, config.shouldersY, config.shouldersY)}${roots.map((root) => root.replace(/^M [^ ]+ [^ ]+ C/, ' C')).join('')}`;

    return { crownOuter, crownInner, pulp, roots, gum, bone, ligament, cementum, canalLines, outline };
  }

  function getLayerContent(toothKey, ageMode, layerId) {
    const tooth = TEETH[toothKey];
    const ageLabel = ageMode === 'young' ? 'young tooth' : 'adult tooth';
    if (layerId === 'overview') {
      return {
        kicker: 'Tooth overview',
        title: tooth.overviewTitle,
        description: `${tooth.overview} ${ageMode === 'young' ? 'This younger stage usually shows larger pulp space and shorter developing support.' : 'This adult stage shows mature support, long-term loading, and more established function.'}`,
        function: `${tooth.label} ${tooth.role}.`,
        why: `That matters because this tooth depends on a healthy ${tooth.surface}, stable support, and a calm gumline to keep doing its job well.`,
        care: `Daily care should prioritise ${tooth.care}.`,
        risk: `When neglected, the most common pressure points are ${tooth.risk}.`,
        tip: ageMode === 'young' ? tooth.factYoung : tooth.factAdult
      };
    }
    const label = LAYERS[layerId].label;
    const builders = {
      enamel: {
        title: `${label} protects the ${tooth.surface}.`,
        description: `Enamel is the hardest outer layer of the ${ageLabel} and shields the crown where ${tooth.role}.`,
        function: `It resists friction, acids, and everyday contact so the outer surface can stay smooth and protective.`,
        why: `If enamel thins, deeper structure becomes more exposed and the tooth may look or feel different faster.`,
        care: `Support it with low-abrasion brushing, fluoride exposure, and steady plaque removal.`,
        risk: `Repeated acid attack, wear, or plaque retention can accelerate ${tooth.risk}.`,
        tip: `Protect the ${tooth.surface} before it feels sensitive.`
      },
      dentin: {
        title: `${label} supports the tooth from inside.`,
        description: `Dentin sits beneath enamel and gives the ${tooth.label.toLowerCase()} strength, resilience, and internal bulk.`,
        function: `It helps the tooth absorb normal chewing forces without behaving like brittle porcelain.`,
        why: `If dentin becomes exposed, temperature, touch, and sweet foods may be felt more easily.`,
        care: `The best strategy is preserving the enamel shell and lowering plaque and acid pressure.`,
        risk: `Exposed dentin can intensify sensitivity and make wear feel more noticeable.`,
        tip: `Sensitivity often means a protective outer layer has become thinner.`
      },
      pulp: {
        title: `${label} keeps the tooth alive.`,
        description: `The pulp contains nerves and blood supply that nourish the tooth and help it respond to injury or stress.`,
        function: `It supports vitality, sensation, and internal repair signals inside the tooth.`,
        why: `In a ${ageLabel}, pulp shape and size influence how deeply wear or trauma may affect the tooth.`,
        care: `Watch for lingering pain, trauma, cracks, or strong biting sensitivity.`,
        risk: `Untreated stress can inflame the pulp and move discomfort from mild to persistent.`,
        tip: `A tooth can look intact from the outside while deeper tissues are irritated.`
      },
      root: {
        title: `${label} anchors the tooth below the surface.`,
        description: `The root secures the tooth in bone and transfers load away from the crown while ${tooth.role}.`,
        function: `It provides stability and helps the tooth tolerate normal everyday pressure.`,
        why: `Without root support, even a strong crown cannot remain comfortable for long.`,
        care: `Healthy gums and low inflammation are essential for long-term root stability.`,
        risk: `Support loss can contribute to mobility, sensitivity, and less confident chewing.`,
        tip: `Stable roots depend on the tissue around them, not only the tooth above them.`
      },
      gum: {
        title: `${label} creates the soft-tissue seal.`,
        description: `Healthy gum tissue wraps around the neck of the tooth and helps block bacteria from moving deeper.`,
        function: `It protects the transition from crown to root and supports comfort near the gumline.`,
        why: `Inflamed gum changes can expose delicate root surfaces and alter how the tooth looks or feels.`,
        care: `Angle cleaning toward the gumline and remove plaque before it stays long enough to irritate tissue.`,
        risk: `Bleeding, swelling, and recession are early signs that the seal is under pressure.`,
        tip: `Gentle technique usually helps more than stronger pressure.`
      },
      cementum: {
        title: `${label} coats the root surface.`,
        description: `Cementum is a softer mineral layer that covers the root and supports fibre attachment below the gumline.`,
        function: `It helps the tooth connect to the ligament system that keeps it stable in the socket.`,
        why: `Unlike enamel, exposed cementum needs gentler care and protection from aggressive abrasion.`,
        care: `Prevent recession where possible and clean exposed root surfaces carefully.`,
        risk: `If root coating is exposed, sensitivity and wear can develop more quickly.`,
        tip: `Root surfaces prefer finesse, not force.`
      },
      rootCanal: {
        title: `${label} carries the internal pathway.`,
        description: `The root canal is the route through which living tissue extends from the crown deeper into the root.`,
        function: `It supports vitality and links the pulp to surrounding tissues.`,
        why: `Changes inside this pathway matter when decay, trauma, or cracks reach deeper levels.`,
        care: `Persistent pressure pain, colour change, or lingering sensitivity should not be ignored.`,
        risk: `Deep irritation can compromise the living center even when the outside still looks calm.`,
        tip: `Internal change often arrives before obvious visible damage.`
      },
      alveolarBone: {
        title: `${label} supports the socket.`,
        description: `This part of the jaw surrounds the root and provides the solid housing needed for the tooth to function well.`,
        function: `It stabilises the tooth and adapts to healthy load over time.`,
        why: `Bone support helps determine whether the tooth stays comfortable, steady, and easy to clean around.`,
        care: `Control chronic inflammation and keep plaque low around the tooth and neighbouring gumline.`,
        risk: `Support loss can change contour, stability, and chewing comfort.`,
        tip: `Healthy bone is usually the hidden reason a tooth feels dependable.`
      },
      periodontalLigament: {
        title: `${label} acts like a suspension system.`,
        description: `Tiny ligament fibres connect root to bone and allow microscopic movement instead of rigid impact.`,
        function: `It cushions force, adds comfort, and helps the tooth feel responsive when biting.`,
        why: `This support layer is one reason teeth can handle pressure without feeling fixed like stone.`,
        care: `Reduce overload from clenching and protect the surrounding tissues from inflammation.`,
        risk: `An irritated ligament can make the tooth feel high, sore, or pressure-sensitive.`,
        tip: `Some healthy tooth movement is normal because the ligament is doing its job.`
      }
    };
    return { kicker: LAYERS[layerId].kicker, ...builders[layerId] };
  }

  function hotspotClass(button, align) {
    button.classList.remove('is-align-left', 'is-align-right', 'is-align-top', 'is-align-bottom');
    button.classList.add(`is-align-${align}`);
  }

  function buildSvg(toothKey, ageMode) {
    const geom = getToothGeometry(toothKey, ageMode);
    const ageClass = ageMode === 'young' ? 'is-age-young' : 'is-age-adult';
    return `
      <svg class="cts-tooth-svg ${ageClass}" viewBox="0 0 332 560" role="img" aria-label="${TEETH[toothKey].label} diagram">
        <path class="cts-outline-path" d="${geom.outline}" />
        <path class="cts-shimmer-path" d="${geom.outline}" />
        <g class="cts-tooth-core">
          <g class="cts-region cts-region--alveolarBone" data-region-id="alveolarBone"><path d="${geom.bone}" /></g>
          <g class="cts-region cts-region--gum" data-region-id="gum"><path d="${geom.gum}" /></g>
          <g class="cts-region cts-region--root" data-region-id="root">${geom.roots.map((path) => `<path d="${path}" />`).join('')}</g>
          <g class="cts-region cts-region--periodontalLigament" data-region-id="periodontalLigament">${geom.ligament.map((path) => `<path d="${path}" />`).join('')}</g>
          <g class="cts-region cts-region--cementum" data-region-id="cementum">${geom.cementum.map((path) => `<path d="${path}" />`).join('')}</g>
          <g class="cts-region cts-region--enamel" data-region-id="enamel"><path d="${geom.crownOuter}" /></g>
          <g class="cts-region cts-region--dentin" data-region-id="dentin"><path d="${geom.crownInner}" /></g>
          <g class="cts-region cts-region--pulp" data-region-id="pulp"><path d="${geom.pulp}" /></g>
          <g class="cts-region cts-region--rootCanal" data-region-id="rootCanal">${geom.canalLines.map((path) => `<path d="${path}" />`).join('')}</g>
        </g>
      </svg>
    `;
  }

  function initSection(root) {
    if (!root || root.hasAttribute('data-ts-initialized')) return;
    root.setAttribute('data-ts-initialized', 'true');
    const configNode = root.querySelector('[data-ts-config]');
    const config = configNode ? JSON.parse(configNode.textContent) : {};
    const tabs = Array.from(root.querySelectorAll('[data-ts-tooth-tabs] [data-tooth-type]'));
    const ageButtons = Array.from(root.querySelectorAll('[data-age-mode]'));
    const hotspotButtons = Array.from(root.querySelectorAll('[data-ts-hotspots] [data-layer-id]'));
    const progressButtons = Array.from(root.querySelectorAll('[data-progress-tooth]'));
    const currentLayer = root.querySelector('[data-ts-diagram-current]');
    const nextLayer = root.querySelector('[data-ts-diagram-next]');
    const mobileSheet = root.querySelector('[data-ts-mobile-sheet]');
    const closeButtons = Array.from(root.querySelectorAll('[data-ts-sheet-close]'));
    const titleTargets = root.querySelectorAll('[data-ts-current-tooth-title]');
    const modeTargets = root.querySelectorAll('[data-ts-panel-mode]');
    const progressSummary = root.querySelectorAll('[data-ts-progress-summary]');
    const functionChips = root.querySelectorAll('[data-ts-function-chips]');
    const careChips = root.querySelectorAll('[data-ts-care-chips]');
    const riskTitleTargets = root.querySelectorAll('[data-ts-risk-title]');
    const riskCopyTargets = root.querySelectorAll('[data-ts-risk-copy]');
    const factTitleTargets = root.querySelectorAll('[data-ts-fact-title]');
    const factCopyTargets = root.querySelectorAll('[data-ts-fact-copy]');
    const panelFields = {
      toothPill: root.querySelectorAll('[data-ts-tooth-pill]'),
      agePill: root.querySelectorAll('[data-ts-age-pill]'),
      layerKicker: root.querySelectorAll('[data-ts-layer-kicker]'),
      title: root.querySelectorAll('[data-ts-panel-title]'),
      description: root.querySelectorAll('[data-ts-panel-description]'),
      fn: root.querySelectorAll('[data-ts-card-function]'),
      why: root.querySelectorAll('[data-ts-card-why]'),
      care: root.querySelectorAll('[data-ts-card-care]'),
      risk: root.querySelectorAll('[data-ts-card-risk]'),
      tip: root.querySelectorAll('[data-ts-card-tip]')
    };

    const state = {
      tooth: TEETH[config.defaultToothType] ? config.defaultToothType : 'incisors',
      age: 'young',
      layer: 'overview',
      selectedLayer: 'overview',
      hoverLayer: null,
      visited: new Set()
    };

    function isMobile() {
      return window.innerWidth < MOBILE_BREAKPOINT;
    }

    function syncLayerState() {
      state.layer = state.hoverLayer || state.selectedLayer;
    }

    function setText(targets, value) {
      targets.forEach((node) => {
        node.textContent = value;
      });
    }

    function setHtml(targets, value) {
      targets.forEach((node) => {
        node.innerHTML = value;
      });
    }

    function renderChips(targets, items) {
      const html = items.map((item) => `<span class="cts-chip">${item}</span>`).join('');
      setHtml(targets, html);
    }

    function renderDiagram() {
      nextLayer.innerHTML = buildSvg(state.tooth, state.age);
      nextLayer.classList.add('is-entering');
      currentLayer.classList.add('is-leaving');
      const swap = () => {
        currentLayer.innerHTML = nextLayer.innerHTML;
        nextLayer.innerHTML = '';
        currentLayer.classList.remove('is-leaving');
        nextLayer.classList.remove('is-entering');
        applyRegionState();
      };
      if (reduceMotion) {
        swap();
      } else {
        window.setTimeout(swap, 260);
      }
    }

    function applyRegionState() {
      const regions = Array.from(currentLayer.querySelectorAll('[data-region-id]'));
      regions.forEach((region) => {
        const id = region.getAttribute('data-region-id');
        const overview = state.layer === 'overview';
        region.classList.toggle('is-active', !overview && id === state.layer);
        region.classList.toggle('is-dimmed', !overview && id !== state.layer);
      });
      root.classList.toggle('has-active-focus', state.layer !== 'overview');
      Object.keys(LAYERS).forEach((key) => root.classList.remove(`is-focus-${key}`));
      if (state.layer !== 'overview') {
        root.classList.add(`is-focus-${state.layer}`);
      }
    }

    function updateHotspots() {
      const positions = TEETH[state.tooth].hotspots;
      hotspotButtons.forEach((button) => {
        const layerId = button.getAttribute('data-layer-id');
        const pos = positions[layerId];
        if (!pos) return;
        button.style.setProperty('--x', pos[0]);
        button.style.setProperty('--y', pos[1]);
        hotspotClass(button, pos[2]);
        button.classList.toggle('is-active', state.layer === layerId);
      });
    }

    function updateControls() {
      tabs.forEach((button) => {
        const active = button.getAttribute('data-tooth-type') === state.tooth;
        button.setAttribute('aria-selected', String(active));
        button.setAttribute('tabindex', active ? '0' : '-1');
        button.classList.toggle('is-visited', state.visited.has(button.getAttribute('data-tooth-type')));
      });
      ageButtons.forEach((button) => {
        button.setAttribute('aria-pressed', String(button.getAttribute('data-age-mode') === state.age));
      });
      progressButtons.forEach((button) => {
        const toothKey = button.getAttribute('data-progress-tooth');
        button.classList.toggle('is-current', toothKey === state.tooth);
        button.classList.toggle('is-visited', state.visited.has(toothKey));
      });
    }

    function updatePanel() {
      const tooth = TEETH[state.tooth];
      const content = getLayerContent(state.tooth, state.age, state.layer);
      const insight = root.querySelector('[data-ts-stage-insight]');
      const insightChip = insight ? insight.querySelector('.cts-stage__insight-chip') : null;
      const insightCopy = insight ? insight.querySelector('.cts-stage__insight-copy') : null;
      const visitedCount = state.visited.size;
      const cards = Array.from(root.querySelectorAll('.cts-info-card'));
      setText(titleTargets, tooth.label);
      setText(modeTargets, state.layer === 'overview' ? 'Preview mode' : 'Layer focus');
      setText(panelFields.toothPill, tooth.label);
      setText(panelFields.agePill, state.age === 'young' ? config.youngLabel || 'Young teeth' : config.adultLabel || 'Adult teeth');
      setText(panelFields.layerKicker, content.kicker);
      setText(panelFields.title, content.title);
      setText(panelFields.description, content.description);
      setText(panelFields.fn, content.function);
      setText(panelFields.why, content.why);
      setText(panelFields.care, content.care);
      setText(panelFields.risk, content.risk);
      setText(panelFields.tip, content.tip);
      setText(riskTitleTargets, tooth.riskTitle);
      setText(riskCopyTargets, tooth.riskCopy);
      setText(factTitleTargets, state.age === 'young' ? 'Growing tooth fact' : 'Adult tooth fact');
      setText(factCopyTargets, state.age === 'young' ? tooth.factYoung : tooth.factAdult);
      renderChips(functionChips, tooth.functionProfile);
      renderChips(careChips, tooth.careProfile);
      setText(progressSummary, `${visitedCount} of ${Object.keys(TEETH).length} explored`);
      if (insightChip) insightChip.textContent = state.layer === 'overview' ? 'Hover or tap a layer' : LAYERS[state.layer].label;
      if (insightCopy) insightCopy.textContent = state.layer === 'overview' ? 'See what each structure does, why it matters, and what helps protect it day after day.' : content.description;
      cards.forEach((card) => card.classList.remove('is-visible'));
      cards.forEach((card, index) => {
        if (reduceMotion) {
          card.classList.add('is-visible');
          return;
        }
        window.setTimeout(() => card.classList.add('is-visible'), 40 + index * 40);
      });
    }

    function updateCompletion() {
      const completion = root.querySelector('[data-ts-completion]');
      if (!completion) return;
      const completed = state.visited.size === Object.keys(TEETH).length;
      completion.hidden = !completed;
      completion.classList.toggle('is-visible', completed && !!config.enableCompletionCelebration);
    }

    function setTooth(toothKey, focusLayer) {
      if (!TEETH[toothKey]) return;
      state.tooth = toothKey;
      state.visited.add(toothKey);
      state.selectedLayer = focusLayer || 'overview';
      state.hoverLayer = null;
      syncLayerState();
      root.classList.remove('has-hover-focus');
      root.classList.remove(...Object.keys(TEETH).map((key) => `is-tooth-${key}`));
      root.classList.add(`is-tooth-${toothKey}`);
      updateControls();
      updateHotspots();
      renderDiagram();
      updatePanel();
      updateCompletion();
    }

    function setAge(ageMode) {
      state.age = ageMode === 'adult' ? 'adult' : 'young';
      state.hoverLayer = null;
      syncLayerState();
      root.classList.remove('has-hover-focus');
      root.classList.toggle('is-age-young', state.age === 'young');
      root.classList.toggle('is-age-adult', state.age === 'adult');
      renderDiagram();
      updatePanel();
      updateHotspots();
      updateControls();
    }

    function setLayer(layerId, openSheet) {
      state.selectedLayer = layerId in LAYERS ? layerId : 'overview';
      state.hoverLayer = null;
      syncLayerState();
      root.classList.remove('has-hover-focus');
      updateHotspots();
      applyRegionState();
      updatePanel();
      if (openSheet && isMobile() && mobileSheet) {
        mobileSheet.hidden = false;
        requestAnimationFrame(() => mobileSheet.classList.add('is-open'));
      }
    }

    function closeSheet() {
      if (!mobileSheet) return;
      mobileSheet.classList.remove('is-open');
      if (reduceMotion) {
        mobileSheet.hidden = true;
      } else {
        window.setTimeout(() => {
          if (!mobileSheet.classList.contains('is-open')) mobileSheet.hidden = true;
        }, 260);
      }
    }

    function reveal() {
      root.classList.add('is-revealed');
    }

    tabs.forEach((button) => {
      button.addEventListener('click', () => setTooth(button.getAttribute('data-tooth-type')));
      button.addEventListener('keydown', (event) => {
        const index = tabs.indexOf(button);
        if (event.key !== 'ArrowRight' && event.key !== 'ArrowLeft') return;
        event.preventDefault();
        const nextIndex = event.key === 'ArrowRight' ? (index + 1) % tabs.length : (index - 1 + tabs.length) % tabs.length;
        tabs[nextIndex].focus();
        setTooth(tabs[nextIndex].getAttribute('data-tooth-type'));
      });
    });

    ageButtons.forEach((button) => {
      button.addEventListener('click', () => setAge(button.getAttribute('data-age-mode')));
    });

    hotspotButtons.forEach((button) => {
      const layerId = button.getAttribute('data-layer-id');
      button.addEventListener('mouseenter', () => {
        if (isMobile() || config.enableHoverPreviews === false) return;
        state.hoverLayer = layerId;
        syncLayerState();
        root.classList.add('has-hover-focus');
        updateHotspots();
        applyRegionState();
        updatePanel();
      });
      button.addEventListener('mouseleave', () => {
        if (isMobile() || config.enableHoverPreviews === false) return;
        state.hoverLayer = null;
        syncLayerState();
        root.classList.remove('has-hover-focus');
        updateHotspots();
        applyRegionState();
        updatePanel();
      });
      button.addEventListener('focus', () => setLayer(layerId, false));
      button.addEventListener('click', () => setLayer(layerId, true));
    });

    progressButtons.forEach((button) => {
      button.addEventListener('click', () => setTooth(button.getAttribute('data-progress-tooth')));
    });

    closeButtons.forEach((button) => button.addEventListener('click', closeSheet));
    window.addEventListener('keydown', (event) => {
      if (event.key === 'Escape') closeSheet();
    });
    window.addEventListener('resize', () => {
      if (!isMobile()) closeSheet();
    });

    if ('IntersectionObserver' in window && !reduceMotion && config.enableAnimations !== false) {
      const observer = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          if (!entry.isIntersecting) return;
          reveal();
          observer.disconnect();
        });
      }, { threshold: 0.22 });
      observer.observe(root);
    } else {
      reveal();
    }

    root.classList.toggle('is-background-motion-enabled', !reduceMotion && config.enableBackgroundMotion !== false);
    root.classList.add('is-age-young');
    setTooth(state.tooth);
  }

  function initWithin(scope) {
    if (!scope) return;
    if (scope.matches && scope.matches(ROOT_SELECTOR)) {
      initSection(scope);
      return;
    }
    if (scope.querySelectorAll) {
      scope.querySelectorAll(ROOT_SELECTOR).forEach(initSection);
    }
  }

  initWithin(document);

  document.addEventListener('shopify:section:load', (event) => {
    initWithin(event.target);
  });
})();
