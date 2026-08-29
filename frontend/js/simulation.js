// === 世界生态调度核心 (WorldSimulation) ===
    // ==========================================
    // 原始生态有限资源与繁衍世界 (水/果/木/石，四季更迭与冬季取暖)
    // ==========================================
    class WorldSimulation {
      constructor() {
        this.terrain = new PureTiltedTerrain(60, 764);
        this.network = new LaneGraph3D();
        this.pois = [];
        this.houses = [];
        this.agents = [];
        this.nextAgentId = 1;
        this.nextHouseId = 1;
        this.totalBirths = 0;
        this.totalDeaths = 0;
        this.totalMiscarriages = 0;
        this.tickCount = 0;
        this.isPaused = false;
        this.speedMult = 2;

        this.seasonTimer = 0.0;
        this.currentSeason = 'Spring';
        this.temperature = 21.5;

        this.waterRegenMultiplier = 1.0;
        this.berryRegenMultiplier = 1.0;
        this.woodRegenMultiplier = 1.0;
        this.stoneRegenMultiplier = 1.0;

        this.showTerrain = true;
        this.showLanes = true;
        this.showPoiStock = true;

        this.selectionType = 'agent';
        this.selectedAgentId = 1;
        this.selectedPoiId = null;
        this.selectedHouseId = null;

        this.initEcology(12);
      }
      initEcology(agentCount) {
        this.terrain.generate();
        this.network = new LaneGraph3D();
        this.pois = [];
        this.houses = [];
        this.agents = [];
        this.nextAgentId = 1;
        this.nextHouseId = 1;
        this.totalBirths = 0;
        this.totalDeaths = 0;
        this.totalMiscarriages = 0;
        this.tickCount = 0;
        this.seasonTimer = 0.0;
        this.currentSeason = 'Spring';
        this.temperature = 21.5;

        const half = this.terrain.worldSize / 2;
        const campNodes = [], waterNodes = [], foodNodes = [], woodNodes = [], stoneNodes = [];
        const allNodeIds = [];
        const poiPositions = [];
        const minPoiDistance = 68.0;

        const findSpacedPos = (radiusRatio) => {
          for (let attempt = 0; attempt < 100; attempt++) {
            const x = (Math.random() - 0.5) * half * (radiusRatio * 2);
            const y = (Math.random() - 0.5) * half * (radiusRatio * 2);
            const elev = this.terrain.sample(x, y).elev;
            const cand = new Vec3(x, y, elev);
            if (poiPositions.every(p => p.distanceTo(cand) >= minPoiDistance)) {
              poiPositions.push(cand);
              return cand;
            }
          }
          // Fallback with looser distance if tight
          for (let attempt = 0; attempt < 50; attempt++) {
            const x = (Math.random() - 0.5) * half * (radiusRatio * 2);
            const y = (Math.random() - 0.5) * half * (radiusRatio * 2);
            const elev = this.terrain.sample(x, y).elev;
            const cand = new Vec3(x, y, elev);
            if (poiPositions.every(p => p.distanceTo(cand) >= minPoiDistance * 0.6)) {
              poiPositions.push(cand);
              return cand;
            }
          }
          const x = (Math.random() - 0.5) * half * (radiusRatio * 2);
          const y = (Math.random() - 0.5) * half * (radiusRatio * 2);
          const elev = this.terrain.sample(x, y).elev;
          const cand = new Vec3(x, y, elev);
          poiPositions.push(cand);
          return cand;
        };

        // 1. 避风营地 (6 处，储量无限，保持间距)
        for (let i = 0; i < 6; i++) {
          const p = findSpacedPos(0.70);
          p.z += 0.5;
          const nid = this.network.addNode(p.x, p.y, p.z, 'camp');
          campNodes.push(nid);
          allNodeIds.push(nid);
          this.pois.push({ id: i + 1, type: 'Camp', nodeId: nid, pos: p, name: `避风营地 #${i+1}`, currentStock: Infinity, maxStock: Infinity, baseRegenRate: 0, regenRate: 0 });
        }

        // 2. 随机分布清泉 (6 处，上限 60.0 单位，产速 2.00 单位/秒，全图随机分布且保持间距)
        for (let i = 0; i < 6; i++) {
          const p = findSpacedPos(0.80);
          const nid = this.network.addNode(p.x, p.y, p.z, 'water');
          waterNodes.push(nid);
          allNodeIds.push(nid);
          const baseRate = 2.00;
          this.pois.push({ id: i + 10, type: 'Water', nodeId: nid, pos: p, name: `天然清泉 #${i+1}`, currentStock: 45.0, maxStock: 60.0, baseRegenRate: baseRate, regenRate: baseRate * this.waterRegenMultiplier });
        }

        // 3. 缓坡浆果灌木 (6 处，上限 60.0 单位，产速 2.00 单位/秒，保持间距)
        for (let i = 0; i < 6; i++) {
          const p = findSpacedPos(0.80);
          const nid = this.network.addNode(p.x, p.y, p.z, 'food');
          foodNodes.push(nid);
          allNodeIds.push(nid);
          const baseRate = 2.00;
          this.pois.push({ id: i + 20, type: 'Berry', nodeId: nid, pos: p, name: `浆果灌木丛 #${i+1}`, currentStock: 45.0, maxStock: 60.0, baseRegenRate: baseRate, regenRate: baseRate * this.berryRegenMultiplier });
        }

        // 4. 茂密林木 (4 处，缩减为4个，上限 60.0 单位，产速 2.00 单位/秒，保持间距)
        for (let i = 0; i < 4; i++) {
          const p = findSpacedPos(0.80);
          const nid = this.network.addNode(p.x, p.y, p.z, 'wood');
          woodNodes.push(nid);
          allNodeIds.push(nid);
          const baseRate = 2.00;
          this.pois.push({ id: i + 30, type: 'Wood', nodeId: nid, pos: p, name: `茂密林木 #${i+1}`, currentStock: 45.0, maxStock: 60.0, baseRegenRate: baseRate, regenRate: baseRate * this.woodRegenMultiplier });
        }

        // 5. 嶙峋石矿 (2 处，缩减为2个，上限 60.0 单位，产速 1.50 单位/秒，保持间距)
        for (let i = 0; i < 2; i++) {
          const p = findSpacedPos(0.80);
          const nid = this.network.addNode(p.x, p.y, p.z, 'stone');
          stoneNodes.push(nid);
          allNodeIds.push(nid);
          const baseRate = 1.50;
          this.pois.push({ id: i + 40, type: 'Stone', nodeId: nid, pos: p, name: `嶙峋石矿 #${i+1}`, currentStock: 45.0, maxStock: 60.0, baseRegenRate: baseRate, regenRate: baseRate * this.stoneRegenMultiplier });
        }

        // 6. 璀璨金矿 (全图 1 处金矿，上限 60.0 单位，产速 1.20 单位/秒，保持间距)
        const goldNodes = [];
        {
          const p = findSpacedPos(0.80);
          const nid = this.network.addNode(p.x, p.y, p.z, 'gold');
          goldNodes.push(nid);
          allNodeIds.push(nid);
          const baseRate = 1.20;
          this.pois.push({ id: 50, type: 'Gold', nodeId: nid, pos: p, name: '璀璨金矿 #1', currentStock: 45.0, maxStock: 60.0, baseRegenRate: baseRate, regenRate: baseRate * (this.goldRegenMultiplier || 1.0) });
        }

        // 6. 地形过渡节点
        for (let i = 0; i < 16; i++) {
          const x = (Math.random() - 0.5) * half * 1.7;
          const y = (Math.random() - 0.5) * half * 1.7;
          const elev = this.terrain.sample(x, y).elev;
          allNodeIds.push(this.network.addNode(x, y, elev, 'ground'));
        }

        // 7. 铺设道路与直连越野便道
        for (let i = 0; i < allNodeIds.length; i++) {
          for (let j = i + 1; j < allNodeIds.length; j++) {
            const idA = allNodeIds[i], idB = allNodeIds[j];
            const posA = this.network.nodes.get(idA).pos;
            const posB = this.network.nodes.get(idB).pos;
            const dist = posA.distanceTo(posB);

            if (dist < 175) {
              const deltaZ = Math.abs(posA.z - posB.z);
              const roadClass = deltaZ > 8 ? 'cobble' : 'dirt';
              this.network.addLane(idA, idB, roadClass, false);
              this.network.addLane(idB, idA, roadClass, false);
            } else if (dist < 360) {
              this.network.addLane(idA, idB, 'dirt', true);
              this.network.addLane(idB, idA, 'dirt', true);
            }
          }
        }

        // 8. 注入部落民 (固定 6 男 6 女共 12 人，年龄在 0~240s 随机，容量 50.0 单位，初始 50%=25.0)
        const totalCount = 12;
        for (let i = 0; i < totalCount; i++) {
          const homeCamp = campNodes[i % campNodes.length];
          const agentId = this.nextAgentId++;
          const gender = i < 6 ? 'female' : 'male';
          const initialAge = Math.random() * 240.0;
          const agent = new PrimitiveAgent(agentId, homeCamp, 34.0 + (i % 4) * 2, initialAge, gender);
          agent.pos = this.network.nodes.get(homeCamp).pos;
          this.agents.push(agent);
        }

        this.selectedAgentId = 1;
        this.campNodes = campNodes;
        this.waterNodes = waterNodes;
        this.foodNodes = foodNodes;
        this.woodNodes = woodNodes;
        this.stoneNodes = stoneNodes;
        this.logEvent(`🏕️ 规格就绪: 固定6男6女开局(年龄0~240s随机)，全图25处POI(含1处金矿)，自身容量上限50.0，四季环境与冬季取暖系统激活！`, 'camp');
      }
      setWaterRegenMultiplier(mult) {
        this.waterRegenMultiplier = mult;
        for (const poi of this.pois) {
          if (poi.type === 'Water') poi.regenRate = poi.baseRegenRate * mult;
        }
      }
      setBerryRegenMultiplier(mult) {
        this.berryRegenMultiplier = mult;
        for (const poi of this.pois) {
          if (poi.type === 'Berry') poi.regenRate = poi.baseRegenRate * mult;
        }
      }
      setWoodRegenMultiplier(mult) {
        this.woodRegenMultiplier = mult;
        for (const poi of this.pois) {
          if (poi.type === 'Wood') poi.regenRate = poi.baseRegenRate * mult;
        }
      }
      setStoneRegenMultiplier(mult) {
        this.stoneRegenMultiplier = mult;
        for (const poi of this.pois) {
          if (poi.type === 'Stone') poi.regenRate = poi.baseRegenRate * mult;
        }
      }
      tick() {
        if (this.isPaused) return;

        const dt = 1.0 / 30.0;

        for (let step = 0; step < this.speedMult; step++) {
          this.tickCount++;

          // 0. 四季轮转与气温计算 (240秒一年，每季60秒)
          this.seasonTimer += dt;
          const yearLength = 240.0;
          const seasonIdx = Math.floor((this.seasonTimer % yearLength) / 60.0);
          const prevSeason = this.currentSeason;
          this.currentSeason = ['Spring', 'Summer', 'Autumn', 'Winter'][seasonIdx] || 'Spring';

          if (this.currentSeason !== prevSeason) {
            const seasonNames = {
              'Spring': '🌸 春季 (大地回春，气候温和)',
              'Summer': '☀️ 夏季 (炎炎夏日，草木茂盛)',
              'Autumn': '🍂 秋季 (秋风送爽，抓紧备柴过冬)',
              'Winter': '❄️ 冬季 (严寒降临，房屋消耗木头取暖)'
            };
            this.logEvent(`季节更替: 步入 ${seasonNames[this.currentSeason]}！`, 'camp');
          }

          const angle = ((this.seasonTimer % yearLength) / yearLength) * Math.PI * 2;
          this.temperature = 14.0 + 17.0 * Math.sin(angle);

          // 冬季严寒供暖消耗：低温或冬季时房屋消耗木材取暖
          if (this.currentSeason === 'Winter' || this.temperature < 5.0) {
            const woodBurnRate = 0.12 * dt;
            for (const house of this.houses) {
              if (!house.isRuin && house.tier !== 'Tier0Warehouse') {
                house.pantryWood = Math.max(0, house.pantryWood - woodBurnRate);
              }
            }
          }

          // 道路自然杂草丛生与退化衰减
          this.network.tickWearDecay(dt);

          for (const poi of this.pois) {
            if (poi.regenRate > 0 && isFinite(poi.currentStock)) {
              poi.currentStock = Math.min(poi.maxStock, poi.currentStock + poi.regenRate * dt);
            }
          }

          const newborns = [];

          for (const agent of this.agents) {
            if (!agent.isAlive) continue;

            if (agent.readyToBirth) {
              agent.readyToBirth = false;
              newborns.push({ motherId: agent.id, campNode: agent.homeCampNode });
            }

            if (agent.state === 'DrinkingAtWater') {
              const poi = this.pois.find(p => p.type === 'Water' && p.pos.distanceTo(agent.pos) < 22);
              if (poi && poi.currentStock > 0.01) {
                const need = Math.max(0, 50.0 - agent.thirst);
                const extracted = Math.min(poi.currentStock, Math.min(need, 4.0 * dt));
                poi.currentStock -= extracted;
                agent.thirst = Math.min(50.0, agent.thirst + extracted);

                if (agent.homeHouseId !== null) {
                  const house = this.houses.find(h => h.id === agent.homeHouseId);
                  if (house && house.pantryWater < house.maxPantryWater && poi.currentStock > 0.01) {
                    const houseNeed = house.maxPantryWater - house.pantryWater;
                    const stockExtracted = Math.min(poi.currentStock, Math.min(houseNeed, 4.0 * dt));
                    poi.currentStock -= stockExtracted;
                    house.pantryWater = Math.min(house.maxPantryWater, house.pantryWater + stockExtracted);
                  }
                }
              }
            } else if (agent.state === 'ForagingFood') {
              const poi = this.pois.find(p => p.type === 'Berry' && p.pos.distanceTo(agent.pos) < 22);
              if (poi && poi.currentStock > 0.01) {
                const need = Math.max(0, 50.0 - agent.hunger);
                const extracted = Math.min(poi.currentStock, Math.min(need, 4.0 * dt));
                poi.currentStock -= extracted;
                agent.hunger = Math.min(50.0, agent.hunger + extracted);

                if (agent.homeHouseId !== null) {
                  const house = this.houses.find(h => h.id === agent.homeHouseId);
                  if (house && house.pantryFood < house.maxPantryFood && poi.currentStock > 0.01) {
                    const houseNeed = house.maxPantryFood - house.pantryFood;
                    const stockExtracted = Math.min(poi.currentStock, Math.min(houseNeed, 4.0 * dt));
                    poi.currentStock -= stockExtracted;
                    house.pantryFood = Math.min(house.maxPantryFood, house.pantryFood + stockExtracted);
                  }
                }
              }
            } else if (agent.state === 'GatheringWood') {
              const poi = this.pois.find(p => p.type === 'Wood' && p.pos.distanceTo(agent.pos) < 22);
              if (poi && poi.currentStock > 0.01 && agent.homeHouseId !== null) {
                const house = this.houses.find(h => h.id === agent.homeHouseId);
                if (house && house.pantryWood < house.maxPantryWood) {
                  const houseNeed = house.maxPantryWood - house.pantryWood;
                  const stockExtracted = Math.min(poi.currentStock, Math.min(houseNeed, 4.0 * dt));
                  poi.currentStock -= stockExtracted;
                  house.pantryWood = Math.min(house.maxPantryWood, house.pantryWood + stockExtracted);
                }
              }
            } else if (agent.state === 'MiningStone') {
              const poi = this.pois.find(p => p.type === 'Stone' && p.pos.distanceTo(agent.pos) < 22);
              if (poi && poi.currentStock > 0.01 && agent.homeHouseId !== null) {
                const house = this.houses.find(h => h.id === agent.homeHouseId);
                if (house && house.pantryStone < house.maxPantryStone) {
                  const houseNeed = house.maxPantryStone - house.pantryStone;
                  const stockExtracted = Math.min(poi.currentStock, Math.min(houseNeed, 3.0 * dt));
                  poi.currentStock -= stockExtracted;
                  house.pantryStone = Math.min(house.maxPantryStone, house.pantryStone + stockExtracted);
                }
              }
            } else if (agent.state === 'MiningGold') {
              const poi = this.pois.find(p => p.type === 'Gold' && p.pos.distanceTo(agent.pos) < 22);
              if (poi && poi.currentStock > 0.01) {
                // 小人随身携带无限黄金
                const extracted = Math.min(poi.currentStock, 3.0 * dt);
                poi.currentStock -= extracted;
                agent.carriedGold = (agent.carriedGold || 0.0) + extracted;

                // 若家宅需要黄金升级，同时将黄金存入家宅金库
                if (agent.homeHouseId !== null) {
                  const house = this.houses.find(h => h.id === agent.homeHouseId);
                  if (house && house.pantryGold < house.maxPantryGold) {
                    const deposit = Math.min(extracted, house.maxPantryGold - house.pantryGold);
                    house.pantryGold = Math.min(house.maxPantryGold, house.pantryGold + deposit);
                  }
                }
              }
            } else if (agent.state === 'RestingAtCamp') {
              // 当在私宅休息时，消耗房屋独立储备以维持水粮
              if (agent.homeHouseId !== null) {
                const house = this.houses.find(h => h.id === agent.homeHouseId);
                if (house) {
                  if (agent.thirst < 35.0 && house.pantryWater > 0.05) {
                    const drink = Math.min(50.0 - agent.thirst, Math.min(house.pantryWater, 3.0 * dt));
                    house.pantryWater = Math.max(0, house.pantryWater - drink);
                    agent.thirst = Math.min(50.0, agent.thirst + drink);
                  }
                  if (agent.hunger < 35.0 && house.pantryFood > 0.05) {
                    const eat = Math.min(50.0 - agent.hunger, Math.min(house.pantryFood, 3.0 * dt));
                    house.pantryFood = Math.max(0, house.pantryFood - eat);
                    agent.hunger = Math.min(50.0, agent.hunger + eat);
                  }
                }
              }
            }
          }

          // 分娩新生儿 (年龄 0.0s，初始水粮 50% = 25.0 单位，入驻家庭私宅与父母共享水粮)
          for (const { motherId, campNode } of newborns) {
            const babyId = this.nextAgentId++;
            this.totalBirths++;
            const babyGender = Math.random() < 0.5 ? 'female' : 'male';
            const genderStr = babyGender === 'female' ? '女婴 ♀' : '男婴 ♂';

            const mother = this.agents.find(a => a.id === motherId);
            const fatherId = mother ? mother.spouseId : null;
            const father = fatherId ? this.agents.find(a => a.id === fatherId) : null;
            const familyHouseId = (mother && mother.homeHouseId !== null) ? mother.homeHouseId : (father ? father.homeHouseId : null);

            let birthNode = campNode;
            if (familyHouseId !== null) {
              const house = this.houses.find(h => h.id === familyHouseId);
              if (house) birthNode = house.doorNodeId;
            }

            const baby = new PrimitiveAgent(babyId, birthNode, 34.0, 0.0, babyGender);
            baby.pos = this.network.nodes.get(birthNode).pos;
            baby.hunger = 25.0; // 50% of 50.0
            baby.thirst = 25.0; // 50% of 50.0
            baby.stamina = 100;
            baby.motherId = motherId;
            baby.fatherId = fatherId;
            baby.homeHouseId = familyHouseId; // 未盖房小孩与父母共享私宅与水粮
            baby.stamina = 100;
            baby.motherId = motherId;
            baby.fatherId = fatherId;
            baby.homeHouseId = familyHouseId; // 未盖房小孩与父母共享私宅与水粮

            if (mother) {
              mother.children.push(babyId);
            }
            if (fatherId && father) {
              father.children.push(babyId);
            }

            this.agents.push(baby);
            const parentsDesc = fatherId ? `母亲 #${motherId} 与 父亲 #${fatherId}` : `母亲 #${motherId}`;
            const houseDesc = familyHouseId !== null ? `，入驻 #${familyHouseId} 号家庭私宅` : '';
            this.logEvent(`🍼 ${parentsDesc} 喜添${genderStr} (Agent #${babyId}${houseDesc}，幼年0s，需成长120s)！`, 'birth');
          }

          // 死亡族人伴侣解除婚姻 (重归单身/丧偶)
          for (const agent of this.agents) {
            if (!agent.isAlive && agent.spouseId !== null) {
              const partner = this.agents.find(a => a.id === agent.spouseId);
              if (partner) {
                partner.spouseId = null;
              }
              agent.spouseId = null;
            }
          }

          this.agents = this.agents.filter(a => a.isAlive || a.deathDecayTimer > 0);

          for (const agent of this.agents) {
            const ev = agent.tickMetabolism(dt, this);
            if (ev) {
              if (ev.type === 'death') this.totalDeaths++;
              if (ev.type === 'miscarry') this.totalMiscarriages++;
              this.logEvent(ev.text, ev.type);
            }
          }

          // 自发筑屋建造、修缮、升级与代际继承
          this.tickHousing(dt);

          if (this.tickCount % 15 === 0) {
            this.tickDecisions();
          }

          for (const agent of this.agents) {
            agent.tickMovement(dt, this.network);
          }
        }
      }
      tickHousing(dt) {
        // 1. 房屋自然风化与折旧 (0耐久彻底坍塌消亡)
        const collapsedHouseIds = [];
        for (const h of this.houses) {
          h.tickDepreciation(dt);
          if (h.durability <= 0) {
            collapsedHouseIds.push(h.id);
          }
        }

        if (collapsedHouseIds.length > 0) {
          for (const agent of this.agents) {
            if (agent.homeHouseId !== null && collapsedHouseIds.includes(agent.homeHouseId)) {
              agent.homeHouseId = null;
              agent.homeCampNode = this.findNearestCamp(agent.pos);
            }
          }
          for (const hid of collapsedHouseIds) {
            this.logEvent(`🏚️ 房屋 #${hid} 因自然风化耐久耗尽归零，彻底坍塌消逝！`, 'death');
          }
          this.houses = this.houses.filter(h => h.durability > 0);
          if (this.selectionType === 'house' && collapsedHouseIds.includes(this.selectedHouseId)) {
            this.selectionType = 'agent';
          }
        }

        // 2. 房屋劳作修缮机制 (小人可以劳动修缮房屋)
        for (const house of this.houses) {
          house.isRepairing = false;
          if (house.durability < 85.0 && !house.isRuin) {
            const ownerId = house.ownerId;
            const spouseId = house.spouseId;
            for (const agent of this.agents) {
              if (agent.isAlive && (agent.id === ownerId || spouseId === agent.id)) {
                if (agent.state === 'RestingAtCamp' && agent.stamina >= 35) {
                  agent.state = 'RepairingHouse';
                }
                if (agent.state === 'RepairingHouse') {
                  house.isRepairing = true;
                  house.repair(8.0 * dt);
                  if (house.durability >= 100.0) {
                    agent.state = 'RestingAtCamp';
                    this.logEvent(`🔧 部落民 #${agent.id} 劳作修缮了 #${house.id} 号房屋，耐久度已恢复至 100%！`, 'camp');
                  }
                }
              }
            }
          } else {
            for (const agent of this.agents) {
              if (agent.state === 'RepairingHouse' && agent.homeHouseId === house.id) {
                agent.state = 'RestingAtCamp';
              }
            }
          }
        }

        // 3. 施工与多级房屋升级推进 (材料备齐后继续投入劳力升级，奖励是储备空间增加)
        for (const agent of this.agents) {
          if (!agent.isAlive) continue;
          if (agent.state === 'ConstructingHouse') {
            agent.buildTimer += dt;
            if (agent.buildTimer >= 30.0) {
              agent.buildTimer = 0.0;
              agent.state = 'RestingAtCamp';
              
              if (agent.homeHouseId !== null) {
                const house = this.houses.find(h => h.id === agent.homeHouseId);
                if (house) {
                  const prevTier = house.tier;
                  const success = house.upgradeToNextTier();
                  if (success) {
                    if (prevTier === 'Tier0Warehouse') {
                      // 0级升级为1级茅草房：自动迎娶单身女性并激活生育
                      const singleFemale = this.agents.find(a => a.isAlive && a.gender === 'female' && a.age >= 120.0 && a.spouseId === null);
                      if (singleFemale) {
                        agent.spouseId = singleFemale.id;
                        singleFemale.spouseId = agent.id;
                        singleFemale.homeHouseId = house.id;
                        singleFemale.homeCampNode = house.doorNodeId;
                        house.spouseId = singleFemale.id;
                        this.logEvent(`🎉 0级仓库备齐水粮并升级为 1级茅草房！迎娶单身女性 #${singleFemale.id} ♀ 结为夫妻，激活生育，升级私宅需木材！`, 'camp');
                      } else {
                        this.logEvent(`🎉 0级仓库升级为 1级茅草房！正式激活生育功能，仓储扩容至 20 单位，升级私宅需木材！`, 'camp');
                      }
                    } else if (prevTier === 'Tier1ThatchedHut') {
                      this.logEvent(`🏡 1级茅草房消耗木材升级成功！第 #${house.id} 号房屋晋升为 2级私宅，仓储扩容至 40 单位！升级庄舍需储备石头！`, 'camp');
                    } else if (prevTier === 'Tier2LeanTo') {
                      this.logEvent(`🏛️ 2级私宅消耗石料升级成功！第 #${house.id} 号房屋晋升为 3级木石庄舍，仓储扩容至 80 单位！`, 'camp');
                    } else {
                      this.logEvent(`🏰 终极大庄园竣工！第 #${house.id} 号房屋晋升为 4级氏族大庄园，仓储扩容至 150 单位！`, 'camp');
                    }
                  }
                }
              }
            }
          }
        }

        // 4. 检查房屋是否已备齐升级材料，若备齐且主人在休息，自动启动多级升级
        for (const house of this.houses) {
          if (house.isPantryFull() && house.tier !== 'Tier4Manor') {
            const owner = this.agents.find(a => a.id === house.ownerId && a.isAlive && a.state === 'RestingAtCamp');
            if (owner) {
              owner.state = 'ConstructingHouse';
              owner.buildTimer = 0.0;
            }
          }
        }

        // 5. 自发选址设立 0级仓库 (男性 ♂ 年满 120s 成年饱暖即可立项，无需前期劳力，默认 5 水 5 粮 5 木)
        if (this.tickCount % 30 === 0) {
          for (const agent of this.agents) {
            const isAlreadyOwner = this.houses.some(h => h.ownerId === agent.id);
            if (!agent.isAlive || agent.gender !== 'male' || isAlreadyOwner || agent.state !== 'RestingAtCamp') continue;

            // 设立仓库门槛：男性 ♂、年满 120s 成年、饱暖富足(≥18.0单位)、体力≥75%
            if (agent.age >= 120.0 && agent.hunger >= 18.0 && agent.thirst >= 18.0 && agent.stamina >= 75.0 && Math.random() < 0.15) {
              const angle = Math.random() * Math.PI * 2;
              const dist = 16.0 + Math.random() * 26.0;
              const candX = agent.pos.x + Math.cos(angle) * dist;
              const candY = agent.pos.y + Math.sin(angle) * dist;
              const candZ = this.terrain.sample(candX, candY).elev + 0.3;
              const candPos = new Vec3(candX, candY, candZ);

              let isValid = true;
              for (const h of this.houses) {
                if (h.pos.distanceTo(candPos) < 14.0) {
                  isValid = false;
                  break;
                }
              }

              if (isValid) {
                const houseId = this.nextHouseId++;
                const doorNode = this.network.addNode(candPos.x, candPos.y, candPos.z, 'house');
                const nearestCamp = this.findNearestCamp(candPos);
                if (nearestCamp !== doorNode) {
                  this.network.addLane(doorNode, nearestCamp, 'dirt', false);
                  this.network.addLane(nearestCamp, doorNode, 'dirt', false);
                }

                // 生成 0级仓库 (默认 5 水 5 粮 5 木，无需前期劳作投入)
                const house = new House(houseId, agent.id, candPos, doorNode, 'Tier0Warehouse');
                this.houses.push(house);

                agent.homeHouseId = houseId;
                agent.homeCampNode = doorNode;
                agent.pos = candPos;
                this.logEvent(`📦 部落民 #${agent.id} ♂ 选址建立了第 #${houseId} 号 0级仓库 (无初始资源)，开始自主搬运备货！`, 'camp');
                break;
              }
            }
          }
        }

        // 6. 代际继承与无房族人转让处理
        for (const house of this.houses) {
          const ownerAlive = this.agents.some(a => a.id === house.ownerId && a.isAlive);
          if (!ownerAlive && !house.isRuin) {
            const formerOwnerId = house.ownerId;
            // 第一顺位：寻找原户主在世且无房的直系后代 (优先年长成年后代)
            const descendantHeir = this.agents
              .filter(a => a.isAlive && a.homeHouseId === null && (a.motherId === formerOwnerId || a.fatherId === formerOwnerId))
              .sort((a, b) => b.age - a.age)[0];

            if (descendantHeir) {
              house.ownerId = descendantHeir.id;
              house.generation++;
              descendantHeir.homeHouseId = house.id;
              descendantHeir.homeCampNode = house.doorNodeId;
              this.logEvent(`📜 直系血脉继承: #${house.id} 号宅舍由后代族人 Agent #${descendantHeir.id} 继承确权 (第${house.generation}代)！`, 'camp');
            } else {
              // 第二顺位：无后代或后代均已有房，转让给任意在世无房族人 (优先年长成年人)
              const fallbackHeir = this.agents
                .filter(a => a.isAlive && a.homeHouseId === null)
                .sort((a, b) => b.age - a.age)[0];

              if (fallbackHeir) {
                house.ownerId = fallbackHeir.id;
                house.generation++;
                fallbackHeir.homeHouseId = house.id;
                fallbackHeir.homeCampNode = house.doorNodeId;
                this.logEvent(`🤝 氏族互助转让: #${house.id} 号宅舍原户主无无房后代，转让给无房族人 Agent #${fallbackHeir.id} (第${house.generation}任)！`, 'camp');
              } else {
                // 全族均已有房或绝嗣，沦为废墟
                house.isRuin = true;
                this.logEvent(`🏚️ 悲鸣: #${house.id} 号宅舍因户主故去且全族均已有房，成为无主废墟！`, 'death');
              }
            }
          }
        }
      }
      findNearestCamp(pos) {
        let bestNode = this.campNodes[0];
        let minDist = Infinity;
        for (const nid of this.campNodes) {
          const node = this.network.nodes.get(nid);
          if (node) {
            const d = node.pos.distanceTo(pos);
            if (d < minDist) {
              minDist = d;
              bestNode = nid;
            }
          }
        }
        return bestNode;
      }
      findNearestNode(pos) {
        let bestId = null;
        let minDist = Infinity;
        for (const [id, node] of this.network.nodes) {
          const d = node.pos.distanceTo(pos);
          if (d < minDist) {
            minDist = d;
            bestId = id;
          }
        }
        return bestId;
      }
      tickDecisions() {
        const availableWaterNodes = this.pois.filter(p => p.type === 'Water' && p.currentStock > 0.5)
          .map(p => p.nodeId || this.findNearestNode(p.pos)).filter(Boolean);

        const availableFoodNodes = this.pois.filter(p => p.type === 'Berry' && p.currentStock > 0.5)
          .map(p => p.nodeId || this.findNearestNode(p.pos)).filter(Boolean);

        const availableWoodNodes = this.pois.filter(p => p.type === 'Wood' && p.currentStock > 0.5)
          .map(p => p.nodeId || this.findNearestNode(p.pos)).filter(Boolean);

        const availableStoneNodes = this.pois.filter(p => p.type === 'Stone' && p.currentStock > 0.5)
          .map(p => p.nodeId || this.findNearestNode(p.pos)).filter(Boolean);

        const availableGoldNodes = this.pois.filter(p => p.type === 'Gold' && p.currentStock > 0.5)
          .map(p => p.nodeId || this.findNearestNode(p.pos)).filter(Boolean);

        for (const agent of this.agents) {
          if (!agent.isAlive) continue;

          if (agent.state === 'RestingAtCamp') {
            const thirstUrgency = agent.isPregnant ? 27.5 : 20.0; // (满值 50.0)
            const hungerUrgency = agent.isPregnant ? 30.0 : 24.0;  // (满值 50.0)

            if (agent.thirst < thirstUrgency && availableWaterNodes.length > 0) {
              const sortedWater = [...availableWaterNodes].sort((a, b) => {
                const posA = this.network.nodes.get(a).pos;
                const posB = this.network.nodes.get(b).pos;
                return posA.distanceTo(agent.pos) - posB.distanceTo(agent.pos);
              });
              const target = sortedWater[0];
              const path = this.network.findPath(agent.homeCampNode, target);
              if (path && path.length > 0) {
                agent.state = 'SeekingWater';
                agent.targetNode = target;
                agent.route = path;
                agent.routeIndex = 0;
                agent.currentLaneId = path[0];
                agent.distAlongCurve = 0;
              }
            } else if (agent.hunger < hungerUrgency && availableFoodNodes.length > 0) {
              const sortedFood = [...availableFoodNodes].sort((a, b) => {
                const posA = this.network.nodes.get(a).pos;
                const posB = this.network.nodes.get(b).pos;
                return posA.distanceTo(agent.pos) - posB.distanceTo(agent.pos);
              });
              const target = sortedFood[0];
              const path = this.network.findPath(agent.homeCampNode, target);
              if (path && path.length > 0) {
                agent.state = 'SeekingFood';
                agent.targetNode = target;
                agent.route = path;
                agent.routeIndex = 0;
                agent.currentLaneId = path[0];
                agent.distAlongCurve = 0;
              }
            } else if (agent.stamina >= 65 && agent.homeHouseId !== null) {
              // 备货与扩产升级动机：若房屋水/粮/木/石未填满，主动前往采集补给以筹备填满升级
              const myHouse = this.houses.find(h => h.id === agent.homeHouseId);
              if (myHouse && !myHouse.isRuin) {
                if (myHouse.pantryWater < myHouse.maxPantryWater && availableWaterNodes.length > 0 && Math.random() < 0.40) {
                  const sortedWater = [...availableWaterNodes].sort((a, b) => {
                    const posA = this.network.nodes.get(a).pos;
                    const posB = this.network.nodes.get(b).pos;
                    return posA.distanceTo(agent.pos) - posB.distanceTo(agent.pos);
                  });
                  const target = sortedWater[0];
                  const path = this.network.findPath(agent.homeCampNode, target);
                  if (path && path.length > 0) {
                    agent.state = 'SeekingWater';
                    agent.targetNode = target;
                    agent.route = path;
                    agent.routeIndex = 0;
                    agent.currentLaneId = path[0];
                    agent.distAlongCurve = 0;
                  }
                } else if (myHouse.pantryFood < myHouse.maxPantryFood && availableFoodNodes.length > 0 && Math.random() < 0.40) {
                  const sortedFood = [...availableFoodNodes].sort((a, b) => {
                    const posA = this.network.nodes.get(a).pos;
                    const posB = this.network.nodes.get(b).pos;
                    return posA.distanceTo(agent.pos) - posB.distanceTo(agent.pos);
                  });
                  const target = sortedFood[0];
                  const path = this.network.findPath(agent.homeCampNode, target);
                  if (path && path.length > 0) {
                    agent.state = 'SeekingFood';
                    agent.targetNode = target;
                    agent.route = path;
                    agent.routeIndex = 0;
                    agent.currentLaneId = path[0];
                    agent.distAlongCurve = 0;
                  }
                } else if (myHouse.pantryWood < myHouse.maxPantryWood && availableWoodNodes.length > 0 && Math.random() < 0.40) {
                  const sortedWood = [...availableWoodNodes].sort((a, b) => {
                    const posA = this.network.nodes.get(a).pos;
                    const posB = this.network.nodes.get(b).pos;
                    return posA.distanceTo(agent.pos) - posB.distanceTo(agent.pos);
                  });
                  const target = sortedWood[0];
                  const path = this.network.findPath(agent.homeCampNode, target);
                  if (path && path.length > 0) {
                    agent.state = 'SeekingWood';
                    agent.targetNode = target;
                    agent.route = path;
                    agent.routeIndex = 0;
                    agent.currentLaneId = path[0];
                    agent.distAlongCurve = 0;
                  }
                } else if (myHouse.tier !== 'Tier0Warehouse' && myHouse.tier !== 'Tier1ThatchedHut' && myHouse.pantryStone < myHouse.maxPantryStone && availableStoneNodes.length > 0 && Math.random() < 0.40) {
                  // 石头只有盖房子的作用：2级私宅及以上为升级庄舍才去采石
                  const sortedStone = [...availableStoneNodes].sort((a, b) => {
                    const posA = this.network.nodes.get(a).pos;
                    const posB = this.network.nodes.get(b).pos;
                    return posA.distanceTo(agent.pos) - posB.distanceTo(agent.pos);
                  });
                  const target = sortedStone[0];
                  const path = this.network.findPath(agent.homeCampNode, target);
                  if (path && path.length > 0) {
                    agent.state = 'SeekingStone';
                    agent.targetNode = target;
                    agent.route = path;
                    agent.routeIndex = 0;
                    agent.currentLaneId = path[0];
                    agent.distAlongCurve = 0;
                  }
                } else if (myHouse.tier === 'Tier3Homestead' && myHouse.pantryGold < myHouse.maxPantryGold && availableGoldNodes.length > 0 && Math.random() < 0.40) {
                  // 3级木石庄舍升级为最高级氏族大庄园需开采黄金
                  const sortedGold = [...availableGoldNodes].sort((a, b) => {
                    const posA = this.network.nodes.get(a).pos;
                    const posB = this.network.nodes.get(b).pos;
                    return posA.distanceTo(agent.pos) - posB.distanceTo(agent.pos);
                  });
                  const target = sortedGold[0];
                  const path = this.network.findPath(agent.homeCampNode, target);
                  if (path && path.length > 0) {
                    agent.state = 'SeekingGold';
                    agent.targetNode = target;
                    agent.route = path;
                    agent.routeIndex = 0;
                    agent.currentLaneId = path[0];
                    agent.distAlongCurve = 0;
                  }
                }
              }
            } else if (agent.stamina >= 95 && agent.hunger < 35.0 && availableFoodNodes.length > 0 && Math.random() < 0.04) {
              const target = availableFoodNodes[Math.floor(Math.random() * availableFoodNodes.length)];
              const path = this.network.findPath(agent.homeCampNode, target);
              if (path && path.length > 0) {
                agent.state = 'SeekingFood';
                agent.targetNode = target;
                agent.route = path;
                agent.routeIndex = 0;
                agent.currentLaneId = path[0];
                agent.distAlongCurve = 0;
              }
            }
          } else if (agent.state === 'DrinkingAtWater') {
            const poi = this.pois.find(p => p.type === 'Water' && p.pos.distanceTo(agent.pos) < 22);
            const isEmpty = !poi || poi.currentStock <= 0.05;

            if (agent.thirst >= 48.0 || isEmpty) {
              const curr = agent.targetNode || agent.homeCampNode;
              if (agent.hunger < 25.0 && availableFoodNodes.length > 0) {
                const target = availableFoodNodes[Math.floor(Math.random() * availableFoodNodes.length)];
                const path = this.network.findPath(curr, target);
                if (path && path.length > 0) {
                  agent.state = 'SeekingFood';
                  agent.targetNode = target;
                  agent.route = path;
                  agent.routeIndex = 0;
                  agent.currentLaneId = path[0];
                  agent.distAlongCurve = 0;
                }
              } else {
                const targetHome = agent.homeHouseId !== null ? agent.homeCampNode : this.findNearestCamp(agent.pos);
                const path = this.network.findPath(curr, targetHome);
                if (path && path.length > 0) {
                  agent.homeCampNode = targetHome;
                  agent.state = 'ReturningToCamp';
                  agent.targetNode = targetHome;
                  agent.route = path;
                  agent.routeIndex = 0;
                  agent.currentLaneId = path[0];
                  agent.distAlongCurve = 0;
                }
              }
            }
          } else if (agent.state === 'ForagingFood') {
            const poi = this.pois.find(p => p.type === 'Berry' && p.pos.distanceTo(agent.pos) < 22);
            const isEmpty = !poi || poi.currentStock <= 0.05;

            if (agent.hunger >= 48.0 || isEmpty) {
              const curr = agent.targetNode || agent.homeCampNode;
              if (agent.thirst < 25.0 && availableWaterNodes.length > 0) {
                const target = availableWaterNodes[Math.floor(Math.random() * availableWaterNodes.length)];
                const path = this.network.findPath(curr, target);
                if (path && path.length > 0) {
                  agent.state = 'SeekingWater';
                  agent.targetNode = target;
                  agent.route = path;
                  agent.routeIndex = 0;
                  agent.currentLaneId = path[0];
                  agent.distAlongCurve = 0;
                }
              } else {
                const targetHome = agent.homeHouseId !== null ? agent.homeCampNode : this.findNearestCamp(agent.pos);
                const path = this.network.findPath(curr, targetHome);
                if (path && path.length > 0) {
                  agent.homeCampNode = targetHome;
                  agent.state = 'ReturningToCamp';
                  agent.targetNode = targetHome;
                  agent.route = path;
                  agent.routeIndex = 0;
                  agent.currentLaneId = path[0];
                  agent.distAlongCurve = 0;
                }
              }
            }
          } else if (agent.state === 'GatheringWood') {
            const poi = this.pois.find(p => p.type === 'Wood' && p.pos.distanceTo(agent.pos) < 22);
            const isEmpty = !poi || poi.currentStock <= 0.05;
            const myHouse = agent.homeHouseId !== null ? this.houses.find(h => h.id === agent.homeHouseId) : null;
            const isHouseWoodFull = myHouse ? myHouse.pantryWood >= myHouse.maxPantryWood : true;

            if (isEmpty || isHouseWoodFull || agent.hunger < 20.0 || agent.thirst < 20.0) {
              const curr = agent.targetNode || agent.homeCampNode;
              const targetHome = agent.homeHouseId !== null ? agent.homeCampNode : this.findNearestCamp(agent.pos);
              const path = this.network.findPath(curr, targetHome);
              if (path && path.length > 0) {
                agent.homeCampNode = targetHome;
                agent.state = 'ReturningToCamp';
                agent.targetNode = targetHome;
                agent.route = path;
                agent.routeIndex = 0;
                agent.currentLaneId = path[0];
                agent.distAlongCurve = 0;
              }
            }
          } else if (agent.state === 'MiningStone') {
            const poi = this.pois.find(p => p.type === 'Stone' && p.pos.distanceTo(agent.pos) < 22);
            const isEmpty = !poi || poi.currentStock <= 0.05;
            const myHouse = agent.homeHouseId !== null ? this.houses.find(h => h.id === agent.homeHouseId) : null;
            const isHouseStoneFull = myHouse ? myHouse.pantryStone >= myHouse.maxPantryStone : true;

            if (isEmpty || isHouseStoneFull || agent.hunger < 20.0 || agent.thirst < 20.0) {
              const curr = agent.targetNode || agent.homeCampNode;
              const targetHome = agent.homeHouseId !== null ? agent.homeCampNode : this.findNearestCamp(agent.pos);
              const path = this.network.findPath(curr, targetHome);
              if (path && path.length > 0) {
                agent.homeCampNode = targetHome;
                agent.state = 'ReturningToCamp';
                agent.targetNode = targetHome;
                agent.route = path;
                agent.routeIndex = 0;
                agent.currentLaneId = path[0];
                agent.distAlongCurve = 0;
              }
            }
          } else if (agent.state === 'MiningGold') {
            const poi = this.pois.find(p => p.type === 'Gold' && p.pos.distanceTo(agent.pos) < 22);
            const isEmpty = !poi || poi.currentStock <= 0.05;
            const myHouse = agent.homeHouseId !== null ? this.houses.find(h => h.id === agent.homeHouseId) : null;
            const isHouseGoldFull = myHouse ? myHouse.pantryGold >= myHouse.maxPantryGold : true;

            if (isEmpty || isHouseGoldFull || agent.hunger < 20.0 || agent.thirst < 20.0) {
              const curr = agent.targetNode || agent.homeCampNode;
              const targetHome = agent.homeHouseId !== null ? agent.homeCampNode : this.findNearestCamp(agent.pos);
              const path = this.network.findPath(curr, targetHome);
              if (path && path.length > 0) {
                agent.homeCampNode = targetHome;
                agent.state = 'ReturningToCamp';
                agent.targetNode = targetHome;
                agent.route = path;
                agent.routeIndex = 0;
                agent.currentLaneId = path[0];
                agent.distAlongCurve = 0;
              }
            }
          } else if (agent.state === 'SeekingWater') {
            if (availableWaterNodes.length === 0) {
              const curr = agent.targetNode || agent.homeCampNode;
              const targetHome = agent.homeHouseId !== null ? agent.homeCampNode : this.findNearestCamp(agent.pos);
              const path = this.network.findPath(curr, targetHome);
              if (path && path.length > 0) {
                agent.homeCampNode = targetHome;
                agent.state = 'ReturningToCamp';
                agent.targetNode = targetHome;
                agent.route = path;
                agent.routeIndex = 0;
                agent.currentLaneId = path[0];
                agent.distAlongCurve = 0;
              }
            }
          } else if (agent.state === 'SeekingFood') {
            if (availableFoodNodes.length === 0) {
              const curr = agent.targetNode || agent.homeCampNode;
              const targetHome = agent.homeHouseId !== null ? agent.homeCampNode : this.findNearestCamp(agent.pos);
              const path = this.network.findPath(curr, targetHome);
              if (path && path.length > 0) {
                agent.homeCampNode = targetHome;
                agent.state = 'ReturningToCamp';
                agent.targetNode = targetHome;
                agent.route = path;
                agent.routeIndex = 0;
                agent.currentLaneId = path[0];
                agent.distAlongCurve = 0;
              }
            }
          } else if (agent.state === 'SeekingWood') {
            if (availableWoodNodes.length === 0 || agent.hunger < 20.0 || agent.thirst < 20.0) {
              const curr = agent.targetNode || agent.homeCampNode;
              if (agent.thirst < 20.0 && availableWaterNodes.length > 0) {
                const target = availableWaterNodes[0];
                const path = this.network.findPath(curr, target);
                if (path && path.length > 0) {
                  agent.state = 'SeekingWater';
                  agent.targetNode = target;
                  agent.route = path;
                  agent.routeIndex = 0;
                  agent.currentLaneId = path[0];
                  agent.distAlongCurve = 0;
                }
              } else if (agent.hunger < 20.0 && availableFoodNodes.length > 0) {
                const target = availableFoodNodes[0];
                const path = this.network.findPath(curr, target);
                if (path && path.length > 0) {
                  agent.state = 'SeekingFood';
                  agent.targetNode = target;
                  agent.route = path;
                  agent.routeIndex = 0;
                  agent.currentLaneId = path[0];
                  agent.distAlongCurve = 0;
                }
              } else {
                const targetHome = agent.homeHouseId !== null ? agent.homeCampNode : this.findNearestCamp(agent.pos);
                const path = this.network.findPath(curr, targetHome);
                if (path && path.length > 0) {
                  agent.homeCampNode = targetHome;
                  agent.state = 'ReturningToCamp';
                  agent.targetNode = targetHome;
                  agent.route = path;
                  agent.routeIndex = 0;
                  agent.currentLaneId = path[0];
                  agent.distAlongCurve = 0;
                }
              }
            }
          } else if (agent.state === 'SeekingStone') {
            if (availableStoneNodes.length === 0 || agent.hunger < 20.0 || agent.thirst < 20.0) {
              const curr = agent.targetNode || agent.homeCampNode;
              if (agent.thirst < 20.0 && availableWaterNodes.length > 0) {
                const target = availableWaterNodes[0];
                const path = this.network.findPath(curr, target);
                if (path && path.length > 0) {
                  agent.state = 'SeekingWater';
                  agent.targetNode = target;
                  agent.route = path;
                  agent.routeIndex = 0;
                  agent.currentLaneId = path[0];
                  agent.distAlongCurve = 0;
                }
              } else if (agent.hunger < 20.0 && availableFoodNodes.length > 0) {
                const target = availableFoodNodes[0];
                const path = this.network.findPath(curr, target);
                if (path && path.length > 0) {
                  agent.state = 'SeekingFood';
                  agent.targetNode = target;
                  agent.route = path;
                  agent.routeIndex = 0;
                  agent.currentLaneId = path[0];
                  agent.distAlongCurve = 0;
                }
              } else {
                const targetHome = agent.homeHouseId !== null ? agent.homeCampNode : this.findNearestCamp(agent.pos);
                const path = this.network.findPath(curr, targetHome);
                if (path && path.length > 0) {
                  agent.homeCampNode = targetHome;
                  agent.state = 'ReturningToCamp';
                  agent.targetNode = targetHome;
                  agent.route = path;
                  agent.routeIndex = 0;
                  agent.currentLaneId = path[0];
                  agent.distAlongCurve = 0;
                }
              }
            }
          } else if (agent.state === 'SeekingGold') {
            if (availableGoldNodes.length === 0 || agent.hunger < 20.0 || agent.thirst < 20.0) {
              const curr = agent.targetNode || agent.homeCampNode;
              if (agent.thirst < 20.0 && availableWaterNodes.length > 0) {
                const target = availableWaterNodes[0];
                const path = this.network.findPath(curr, target);
                if (path && path.length > 0) {
                  agent.state = 'SeekingWater';
                  agent.targetNode = target;
                  agent.route = path;
                  agent.routeIndex = 0;
                  agent.currentLaneId = path[0];
                  agent.distAlongCurve = 0;
                }
              } else if (agent.hunger < 20.0 && availableFoodNodes.length > 0) {
                const target = availableFoodNodes[0];
                const path = this.network.findPath(curr, target);
                if (path && path.length > 0) {
                  agent.state = 'SeekingFood';
                  agent.targetNode = target;
                  agent.route = path;
                  agent.routeIndex = 0;
                  agent.currentLaneId = path[0];
                  agent.distAlongCurve = 0;
                }
              } else {
                const targetHome = agent.homeHouseId !== null ? agent.homeCampNode : this.findNearestCamp(agent.pos);
                const path = this.network.findPath(curr, targetHome);
                if (path && path.length > 0) {
                  agent.homeCampNode = targetHome;
                  agent.state = 'ReturningToCamp';
                  agent.targetNode = targetHome;
                  agent.route = path;
                  agent.routeIndex = 0;
                  agent.currentLaneId = path[0];
                  agent.distAlongCurve = 0;
                }
              }
            }
          }
        }
      }
      logEvent(msg, type = '') {
        const list = document.getElementById('log-list');
        const entry = document.createElement('div');
        entry.className = `log-entry ${type}`;
        entry.textContent = `[Tick ${this.tickCount}] ${msg}`;
        list.appendChild(entry);
        while (list.children.length > 8) list.removeChild(list.firstChild);
      }
    }
