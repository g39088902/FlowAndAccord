// === 部落民 AI 状态机与生理代谢 ===
    class PrimitiveAgent {
      constructor(id, homeCampNode, maxSpeed = 34.0, initialAge = 120.0, gender = 'female') {
        this.id = id;
        this.homeCampNode = homeCampNode;
        this.maxSpeed = maxSpeed;
        this.state = 'RestingAtCamp';
        this.isAlive = true;
        this.age = initialAge; // 年龄 (秒)
        this.gender = gender; // 'female' ♀ 或 'male' ♂ (只有女性能生育)

        // 自身容量上限提升至 50.0 单位，初始 50% = 25.0 单位
        this.hunger = 25.0;
        this.thirst = 25.0;
        this.stamina = 95;
        this.carriedGold = 0.0; // 随身携带黄金 (无限容量)

        this.homeHouseId = null; // 拥有的私产房屋 ID
        this.buildTimer = 0.0;   // 筑屋劳作计时器

        // 家族血脉与族谱
        this.spouseId = null;
        this.motherId = null;
        this.fatherId = null;
        this.children = [];

        this.isPregnant = false;
        this.pregnancyProgress = 0.0;
        this.readyToBirth = false;
        this.isOffroad = false;
        this.miscarriageTimer = 0.0;
        this.miscarriageCooldown = 0.0;
        this.deathDecayTimer = 12.0;
        this.deathCause = null;

        this.targetNode = null;
        this.currentLaneId = null;
        this.distAlongCurve = 0;
        this.currentVelocity = 0;
        this.route = [];
        this.routeIndex = 0;

        this.pos = new Vec3();
        this.trail = [];
      }
      tickMetabolism(dt, world) {
        if (this.miscarriageTimer > 0) {
          this.miscarriageTimer = Math.max(0, this.miscarriageTimer - dt);
        }
        if (this.miscarriageCooldown > 0) {
          this.miscarriageCooldown = Math.max(0, this.miscarriageCooldown - dt);
        }

        if (!this.isAlive) {
          this.deathDecayTimer = Math.max(0, this.deathDecayTimer - dt);
          return null;
        }

        this.age += dt;

        let eventMsg = null;
        let multiplier = this.isPregnant ? 1.5 : 1.0;

        if (this.state === 'ConstructingHouse' || this.state === 'RepairingHouse') {
          multiplier *= 1.25; // 筑屋与修缮劳动轻微加速代谢
        }

        // 10秒消耗1单位 (未孕 0.10单位/秒，怀孕 0.15单位/秒)
        const decayRate = 0.10 * multiplier;
        this.hunger = Math.max(0, this.hunger - decayRate * dt);
        this.thirst = Math.max(0, this.thirst - decayRate * dt);

        if (this.hunger <= 0.0) {
          this.isAlive = false;
          this.state = 'Dead';
          this.deathCause = '饥荒饿死';
          this.isPregnant = false;
          this.deathDecayTimer = 12.0;
          return { type: 'death', text: `💀 部落民 #${this.id} (${this.gender === 'female' ? '女' : '男'}) 因长期饥荒不幸饿死！` };
        }
        if (this.thirst <= 0.0) {
          this.isAlive = false;
          this.state = 'Dead';
          this.deathCause = '严重脱水';
          this.isPregnant = false;
          this.deathDecayTimer = 12.0;
          return { type: 'death', text: `💀 部落民 #${this.id} (${this.gender === 'female' ? '女' : '男'}) 因严重脱水渴死！` };
        }

        // 受孕判定 (上限50.0单位，饱暖充盈≥37.5即75%，且私宅水粮充足≥10单位激活生育)
        if (this.gender === 'female' && this.spouseId !== null && this.homeHouseId !== null && this.state === 'RestingAtCamp' && !this.isPregnant && this.miscarriageCooldown <= 0) {
          if (this.age >= 120.0 && this.hunger >= 37.5 && this.thirst >= 37.5 && this.stamina >= 75) {
            const myHouse = world ? world.houses.find(h => h.id === this.homeHouseId) : null;
            if (myHouse && myHouse.isFertilityActive()) {
              this.isPregnant = true;
              this.pregnancyProgress = 0.0;
              eventMsg = { type: 'birth', text: `🤰 女性部落民 #${this.id} (配偶 #${this.spouseId}) 在私宅中饱暖充盈(≥37.5单位，水粮木≥10)，成功受孕进入120秒妊娠期！` };
            }
          }
        }

        // 120秒孕期与流产判定 (统一基准流产底线 25%=12.5单位)
        if (this.isPregnant) {
          const miscarryThreshold = 12.5;
          if (this.hunger < miscarryThreshold || this.thirst < miscarryThreshold || this.stamina < 20) {
            this.isPregnant = false;
            this.pregnancyProgress = 0.0;
            this.miscarriageTimer = 5.0;
            this.miscarriageCooldown = 60.0;
            return { type: 'miscarry', text: `🥀 痛惜！女性部落民 #${this.id} 生存指标跌破安全线(<${miscarryThreshold.toFixed(2)}单位)，导致流产 (60秒内不可再受孕)！` };
          }

          this.pregnancyProgress += dt / 120.0;
          if (this.pregnancyProgress >= 1.0) {
            this.isPregnant = false;
            this.pregnancyProgress = 0.0;
            this.readyToBirth = true;
            return { type: 'birth', text: `🍼 喜讯！女性部落民 #${this.id} 历经120秒漫长孕期，顺利产下一名健康的新生儿！` };
          }
        }

        // 休息与劳作状态体力结算
        if (this.state === 'RestingAtCamp') {
          const recoveryRate = 8.0;
          this.stamina = Math.min(100, this.stamina + recoveryRate * dt);
        } else if (this.state === 'ConstructingHouse') {
          this.stamina = Math.max(5, this.stamina - 3.5 * dt); // 筑屋劳动消耗体力
        } else if (this.state === 'RepairingHouse') {
          this.stamina = Math.max(5, this.stamina - 2.5 * dt); // 修缮劳动消耗体力
        }

        return eventMsg;
      }
      tickMovement(dt, network) {
        if (!this.isAlive) {
          this.currentVelocity = 0;
          return;
        }

        const isMoving = this.state === 'SeekingWater' || this.state === 'SeekingFood' || this.state === 'SeekingWood' || this.state === 'SeekingStone' || this.state === 'SeekingGold' || this.state === 'ReturningToCamp';
        if (!isMoving) {
          this.currentVelocity = 0;
          return;
        }

        if (!this.currentLaneId) return;
        const lane = network.lanes.get(this.currentLaneId);
        if (!lane) {
          this.state = 'RestingAtCamp';
          return;
        }

        const deltaZ = lane.curve.p3.z - lane.curve.p0.z;
        const uphill = deltaZ > 0 ? deltaZ / lane.curve.length : 0;
        const staminaBurn = (0.6 + (this.isPregnant ? 0.3 : 0.0)) * (1.0 + uphill * 3.5);
        this.stamina = Math.max(0, this.stamina - staminaBurn * dt);

        const staminaFactor = Math.max(0.2, Math.min(1.0, this.stamina / 25.0));
        // 连续浮点道路速度因子：0.0 (荒野 50%) -> 1.0 (土径 83%) -> 2.0 (夯土 117%) -> 3.0 (石道 150%) -> 4.0 (石板 183%) -> 5.0 (极品大道 217%)
        const roadLevelFactor = Math.min(2.20, Math.max(0.50, 0.50 + 0.333 * lane.wear));
        this.isOffroad = lane.wear < 0.6;
        const targetSpeed = this.maxSpeed * roadLevelFactor * staminaFactor;

        this.currentVelocity += (targetSpeed - this.currentVelocity) * 4 * dt;
        this.distAlongCurve += this.currentVelocity * dt;

        if (this.distAlongCurve >= lane.curve.length) {
          // 踩踏拓路：按步行次数增加 (每次通行 +0.05，上限 5.0)，双向往返共同加固
          const newWear = Math.min(5.0, (lane.wear || 0.0) + 0.05);
          lane.wear = newWear;
          if (lane.reverseId && network.lanes.has(lane.reverseId)) {
            network.lanes.get(lane.reverseId).wear = newWear;
          }

          this.routeIndex++;
          if (this.routeIndex < this.route.length) {
            const nextLane = this.route[this.routeIndex];
            if (network.lanes.has(nextLane)) {
              this.currentLaneId = nextLane;
              this.distAlongCurve = 0;
            } else {
              this.state = 'RestingAtCamp';
            }
          } else {
            this.currentVelocity = 0;
            this.currentLaneId = null;
            this.isOffroad = false;
            if (this.state === 'SeekingWater') this.state = 'DrinkingAtWater';
            else if (this.state === 'SeekingFood') this.state = 'ForagingFood';
            else if (this.state === 'SeekingWood') this.state = 'GatheringWood';
            else if (this.state === 'SeekingStone') this.state = 'MiningStone';
            else if (this.state === 'SeekingGold') this.state = 'MiningGold';
            else if (this.state === 'ReturningToCamp') this.state = 'RestingAtCamp';
          }
        } else {
          const t = this.distAlongCurve / lane.curve.length;
          this.pos = lane.curve.evalPos(t);

          this.trail.push(new Vec3(this.pos.x, this.pos.y, this.pos.z));
          if (this.trail.length > 8) this.trail.shift();
        }
      }
    }
