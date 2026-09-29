package gamification

import "math/rand/v2"

type Rarity string

const (
	Common    Rarity = "common"
	Rare      Rarity = "rare"
	Epic      Rarity = "epic"
	Legendary Rarity = "legendary"
)

var rarityOrder = []Rarity{Common, Rare, Epic, Legendary}

// AchievementXP is the one-time bonus for unlocking an achievement.
var AchievementXP = map[Rarity]int{Common: 25, Rare: 75, Epic: 200, Legendary: 500}

// Stardust is what a duplicate item turns into, and crafting an item costs
// four duplicates of its rarity.
var DuplicateStardust = map[Rarity]int{Common: 5, Rare: 20, Epic: 60, Legendary: 200}

func CraftCost(rarity Rarity) int { return DuplicateStardust[rarity] * 4 }

// ChestForLevel is the chest earned on reaching level: every level gives a
// common chest, every fifth a rare one and every twenty-fifth an epic one.
func ChestForLevel(level int) Rarity {
	switch {
	case level%25 == 0:
		return Epic
	case level%5 == 0:
		return Rare
	default:
		return Common
	}
}

// Item is one cosmetic of the catalog. Items are cosmetic only: chests never
// grant XP or anything that changes a leaderboard.
type Item struct {
	ID     string `json:"id"`
	Kind   string `json:"kind"`
	Rarity Rarity `json:"rarity"`
}

// Drop is one thing that came out of a chest.
type Drop struct {
	ItemID    string `json:"itemId,omitempty"`
	Rarity    Rarity `json:"rarity"`
	Duplicate bool   `json:"duplicate,omitempty"`
	Stardust  int    `json:"stardust,omitempty"`
	Freeze    bool   `json:"freeze,omitempty"`
}

type chestTable struct {
	items int
	// Weight of each rarity for a regular slot, in rarityOrder.
	weights [4]int
	// The last slot is at least this rare.
	guaranteed  Rarity
	freezeOneIn int
}

var chestTables = map[Rarity]chestTable{
	Common:    {items: 1, weights: [4]int{80, 18, 2, 0}, guaranteed: Common, freezeOneIn: 12},
	Rare:      {items: 2, weights: [4]int{55, 35, 9, 1}, guaranteed: Rare, freezeOneIn: 6},
	Epic:      {items: 3, weights: [4]int{30, 40, 25, 5}, guaranteed: Epic, freezeOneIn: 3},
	Legendary: {items: 3, weights: [4]int{10, 35, 35, 20}, guaranteed: Legendary, freezeOneIn: 2},
}

// RollChest decides a chest's contents. It is called once, on the server,
// when the chest is granted, so the client can never re-roll it. Items the
// user already owns, including earlier drops of this chest, become stardust.
func RollChest(tier Rarity, catalog []Item, owned map[string]bool, rng *rand.Rand) []Drop {
	table, ok := chestTables[tier]
	if !ok {
		table = chestTables[Common]
	}
	byRarity := map[Rarity][]Item{}
	for _, item := range catalog {
		byRarity[item.Rarity] = append(byRarity[item.Rarity], item)
	}
	seen := map[string]bool{}
	for id, has := range owned {
		seen[id] = has
	}
	drops := make([]Drop, 0, table.items+1)
	for slot := 0; slot < table.items; slot++ {
		rarity := pickRarity(table.weights, rng)
		if slot == table.items-1 && rarityRank(rarity) < rarityRank(table.guaranteed) {
			rarity = table.guaranteed
		}
		rarity = nearestStocked(rarity, byRarity)
		pool := byRarity[rarity]
		if len(pool) == 0 {
			continue
		}
		// Prefer something new; fall back to a duplicate when the pool is complete.
		var fresh []Item
		for _, item := range pool {
			if !seen[item.ID] {
				fresh = append(fresh, item)
			}
		}
		if len(fresh) > 0 {
			item := fresh[rng.IntN(len(fresh))]
			seen[item.ID] = true
			drops = append(drops, Drop{ItemID: item.ID, Rarity: rarity})
			continue
		}
		item := pool[rng.IntN(len(pool))]
		drops = append(drops, Drop{ItemID: item.ID, Rarity: rarity, Duplicate: true, Stardust: DuplicateStardust[rarity]})
	}
	if table.freezeOneIn > 0 && rng.IntN(table.freezeOneIn) == 0 {
		drops = append(drops, Drop{Rarity: tier, Freeze: true})
	}
	return drops
}

func pickRarity(weights [4]int, rng *rand.Rand) Rarity {
	total := 0
	for _, weight := range weights {
		total += weight
	}
	roll := rng.IntN(total)
	for index, weight := range weights {
		if roll < weight {
			return rarityOrder[index]
		}
		roll -= weight
	}
	return Common
}

func rarityRank(rarity Rarity) int {
	for index, candidate := range rarityOrder {
		if candidate == rarity {
			return index
		}
	}
	return 0
}

// nearestStocked falls back to the closest rarity that has items, preferring
// lower rarities so a sparse catalog never inflates drops.
func nearestStocked(rarity Rarity, byRarity map[Rarity][]Item) Rarity {
	rank := rarityRank(rarity)
	for distance := 0; distance < len(rarityOrder); distance++ {
		for _, candidate := range []int{rank - distance, rank + distance} {
			if candidate >= 0 && candidate < len(rarityOrder) && len(byRarity[rarityOrder[candidate]]) > 0 {
				return rarityOrder[candidate]
			}
		}
	}
	return rarity
}

// PetSpecies are rolled when the egg hatches; Ember is the rare one.
var petSpeciesWeights = []struct {
	Species string
	Weight  int
}{{"mochi", 35}, {"fern", 30}, {"nova", 25}, {"ember", 10}}

func RollPetSpecies(rng *rand.Rand) string {
	roll := rng.IntN(100)
	for _, entry := range petSpeciesWeights {
		if roll < entry.Weight {
			return entry.Species
		}
		roll -= entry.Weight
	}
	return petSpeciesWeights[0].Species
}
