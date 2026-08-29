// === 多级私产房屋模型 ===
    class House {
      constructor(id, ownerId, pos, doorNodeId, tier = 'Tier0Warehouse') {
        this.id = id;
        this.ownerId = ownerId;
        this.spouseId = null;
        this.pos = pos;
        this.doorNodeId = doorNodeId;
        this.tier = tier;
        this.durability = 100.0;
        
        // 区分不同物品独立存储 (多级扩容：10/20/40/80/150)
        // 0级仓库 📦 (容量10) -> 1级茅草房 🛖 (容量20) -> 2级私宅 🏡 (容量40) -> 3级庄舍 🏛️ (容量80) -> 4级庄园 🏰 (容量150)
        const isWarehouse = tier === 'Tier0Warehouse';
        this.pantryWater = isWarehouse ? 0.0 : 10.0; // 0级仓库不附赠任何初始资源，需自主备货
        this.pantryFood = isWarehouse ? 0.0 : 10.0;
        this.pantryWood = isWarehouse ? 0.0 : 10.0;
        this.pantryStone = 0.0;
        this.pantryGold = 0.0;

        const maxCap = isWarehouse ? 10.0 : (tier === 'Tier1ThatchedHut' ? 20.0 : (tier === 'Tier2LeanTo' ? 40.0 : (tier === 'Tier3Homestead' ? 80.0 : 150.0)));
        this.maxPantryWater = maxCap;
        this.maxPantryFood = maxCap;
        this.maxPantryWood = maxCap;
        this.maxPantryStone = maxCap;
        this.maxPantryGold = isWarehouse ? 0.0 : (tier === 'Tier3Homestead' ? 40.0 : (tier === 'Tier4Manor' ? 150.0 : 0.0));

        this.age = 0.0;
        this.generation = 1;
        this.isRuin = false;
        this.constructionProgress = isWarehouse ? 0.0 : 1.0;
        this.isRepairing = false;
      }
      isFertilityActive() {
        // 非0级仓库，水/粮/木均>=10单位；木材<10无法保障过冬取暖，失去生育支持
        return this.tier !== 'Tier0Warehouse' && this.pantryWater >= 10.0 && this.pantryFood >= 10.0 && this.pantryWood >= 10.0 && !this.isRuin;
      }
      isPantryFull() {
        if (this.tier === 'Tier0Warehouse') {
          return this.pantryWater >= this.maxPantryWater && this.pantryFood >= this.maxPantryFood;
        } else if (this.tier === 'Tier1ThatchedHut') {
          // 茅草房升级私宅需要木头
          return this.pantryWood >= this.maxPantryWood && this.pantryWater >= 10.0 && this.pantryFood >= 10.0;
        } else if (this.tier === 'Tier2LeanTo') {
          // 私宅再往上升级需要石头 (石头只有盖房子的作用)
          return this.pantryStone >= this.maxPantryStone && this.pantryWood >= 15.0 && this.pantryWater >= 15.0 && this.pantryFood >= 15.0;
        } else if (this.tier === 'Tier3Homestead') {
          return this.pantryGold >= this.maxPantryGold && this.pantryStone >= this.maxPantryStone && this.pantryWood >= 25.0 && this.pantryWater >= 25.0 && this.pantryFood >= 25.0;
        }
        return false;
      }
      upgradeToNextTier() {
        if (this.tier === 'Tier0Warehouse') {
          this.tier = 'Tier1ThatchedHut';
          this.maxPantryWater = 20.0;
          this.maxPantryFood = 20.0;
          this.maxPantryWood = 20.0;
          this.maxPantryStone = 20.0;
          this.constructionProgress = 1.0;
          return true;
        } else if (this.tier === 'Tier1ThatchedHut') {
          this.tier = 'Tier2LeanTo';
          this.maxPantryWater = 40.0;
          this.maxPantryFood = 40.0;
          this.maxPantryWood = 40.0;
          this.maxPantryStone = 40.0;
          this.constructionProgress = 1.0;
          return true;
        } else if (this.tier === 'Tier2LeanTo') {
          this.tier = 'Tier3Homestead';
          this.maxPantryWater = 80.0;
          this.maxPantryFood = 80.0;
          this.maxPantryWood = 80.0;
          this.maxPantryStone = 80.0;
          this.maxPantryGold = 40.0;
          this.constructionProgress = 1.0;
          return true;
        } else if (this.tier === 'Tier3Homestead') {
          this.tier = 'Tier4Manor';
          this.maxPantryWater = 150.0;
          this.maxPantryFood = 150.0;
          this.maxPantryWood = 150.0;
          this.maxPantryStone = 150.0;
          this.maxPantryGold = 150.0;
          this.constructionProgress = 1.0;
          return true;
        }
        return false;
      }
      repair(amount) {
        this.durability = Math.min(100.0, this.durability + amount);
      }
      tickDepreciation(dt) {
        this.age += dt;
        const decay = this.isRuin ? 0.30 : 0.04;
        this.durability = Math.max(0, this.durability - decay * dt);
      }
    }
