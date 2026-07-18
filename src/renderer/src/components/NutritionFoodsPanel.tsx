import { useCallback, useEffect, useState } from 'react'
import type {
  CreateFoodItemInput,
  FoodItemRecord,
  FoodSearchResult,
  NutritionLookupState
} from '@shared/nutrition'
import { formatMacroG } from '@shared/nutrition'
import { MossButton } from './MossButton'

interface NutritionFoodsPanelProps {
  busy: boolean
  onMutate: (task: () => Promise<void>) => Promise<void>
}

function sourceLabel(source: FoodSearchResult['source']): string {
  switch (source) {
    case 'manual':
      return 'Yours'
    case 'fdc':
      return 'USDA'
    case 'off':
      return 'OFF'
  }
}

export function NutritionFoodsPanel({
  busy,
  onMutate
}: NutritionFoodsPanelProps): React.JSX.Element {
  const [lookupState, setLookupState] = useState<NutritionLookupState | null>(null)
  const [apiKey, setApiKey] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<FoodSearchResult[]>([])
  const [searchBusy, setSearchBusy] = useState(false)
  const [barcode, setBarcode] = useState('')
  const [favorites, setFavorites] = useState<FoodItemRecord[]>([])
  const [recents, setRecents] = useState<FoodItemRecord[]>([])
  const [message, setMessage] = useState<string | null>(null)

  const [createOpen, setCreateOpen] = useState(false)
  const [name, setName] = useState('')
  const [brand, setBrand] = useState('')
  const [kcalPer100g, setKcalPer100g] = useState('')
  const [proteinPer100g, setProteinPer100g] = useState('')
  const [carbsPer100g, setCarbsPer100g] = useState('')
  const [fatPer100g, setFatPer100g] = useState('')
  const [servingLabel, setServingLabel] = useState('1 serving')
  const [servingGrams, setServingGrams] = useState('100')

  const loadCatalog = useCallback(async () => {
    if (!window.moss?.nutrition) return

    const [state, favs, recent] = await Promise.all([
      window.moss.nutrition.getLookupState(),
      window.moss.nutrition.listFavoriteFoods(),
      window.moss.nutrition.listRecentFoods(12)
    ])
    setLookupState(state)
    setFavorites(favs)
    setRecents(recent)
  }, [])

  useEffect(() => {
    void loadCatalog()
  }, [loadCatalog])

  async function handleSaveApiKey(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (!window.moss?.nutrition) return

    await onMutate(async () => {
      await window.moss.nutrition.setUsdaApiKey(apiKey.trim())
      setApiKey('')
      setMessage('USDA API key saved.')
      await loadCatalog()
    })
  }

  async function handleSearch(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (!searchQuery.trim() || !window.moss?.nutrition) return

    setSearchBusy(true)
    setMessage(null)
    try {
      const results = await window.moss.nutrition.searchFoods(searchQuery.trim(), [
        'local',
        'fdc',
        'off'
      ])
      setSearchResults(results)
      if (results.length === 0) {
        setMessage('No matches — try a shorter phrase or add a custom food.')
      }
    } catch (err) {
      setMessage(err instanceof Error ? err.message : 'Search failed')
    } finally {
      setSearchBusy(false)
    }
  }

  async function handleImportResult(result: FoodSearchResult): Promise<void> {
    if (!window.moss?.nutrition) return

    await onMutate(async () => {
      if (result.source === 'fdc') {
        await window.moss.nutrition.importFdcFood(result.externalId)
        setMessage(`Imported ${result.name} from USDA.`)
      } else if (result.source === 'off') {
        const imported = await window.moss.nutrition.lookupBarcode(result.barcode ?? result.externalId)
        if (imported) {
          setMessage(`Imported ${imported.name} from Open Food Facts.`)
        }
      } else {
        setMessage(`${result.name} is already in your catalog.`)
      }
      await loadCatalog()
    })
  }

  async function handleBarcodeLookup(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    if (!barcode.trim() || !window.moss?.nutrition) return

    await onMutate(async () => {
      const item = await window.moss.nutrition.lookupBarcode(barcode.trim())
      if (item) {
        setMessage(`Found ${item.name}${item.brand ? ` (${item.brand})` : ''}.`)
        setBarcode('')
      } else {
        setMessage('Barcode not found in Open Food Facts.')
      }
      await loadCatalog()
    })
  }

  async function handleToggleFavorite(foodItemId: string, isFavorite: boolean): Promise<void> {
    if (!window.moss?.nutrition) return

    await onMutate(async () => {
      if (isFavorite) {
        await window.moss.nutrition.removeFavoriteFood(foodItemId)
      } else {
        await window.moss.nutrition.addFavoriteFood(foodItemId)
      }
      await loadCatalog()
    })
  }

  async function handleCreateFood(event: React.FormEvent): Promise<void> {
    event.preventDefault()
    const kcal = Number(kcalPer100g)
    const grams = Number(servingGrams)
    if (!name.trim() || !Number.isFinite(kcal) || kcal <= 0) return

    const input: CreateFoodItemInput = {
      name: name.trim(),
      brand: brand.trim() || undefined,
      kcalPer100g: kcal,
      proteinPer100g: Number(proteinPer100g) || 0,
      carbsPer100g: Number(carbsPer100g) || 0,
      fatPer100g: Number(fatPer100g) || 0
    }

    if (servingLabel.trim() && Number.isFinite(grams) && grams > 0) {
      input.defaultServing = {
        label: servingLabel.trim(),
        gramWeight: grams,
        isDefault: true
      }
    }

    await onMutate(async () => {
      await window.moss.nutrition.createFoodItem(input)
      setMessage(`Added ${input.name} to your catalog.`)
      setName('')
      setBrand('')
      setKcalPer100g('')
      setProteinPer100g('')
      setCarbsPer100g('')
      setFatPer100g('')
      setCreateOpen(false)
      await loadCatalog()
    })
  }

  function renderFoodRow(item: FoodItemRecord, favoriteIds: Set<string>): React.JSX.Element {
    const isFavorite = favoriteIds.has(item.id)

    return (
      <li key={item.id} className="nutrition-food-row">
        <div className="nutrition-food-row-main">
          <span className="nutrition-food-row-name">{item.name}</span>
          {item.brand && <span className="nutrition-food-row-brand">{item.brand}</span>}
          <span className={`nutrition-source-chip nutrition-source-chip--${item.source}`}>
            {sourceLabel(item.source)}
          </span>
        </div>
        <p className="nutrition-food-row-macros nutrition-mono">
          {Math.round(item.kcalPer100g)} kcal/100g · P {formatMacroG(item.proteinPer100g)} · C{' '}
          {formatMacroG(item.carbsPer100g)} · F {formatMacroG(item.fatPer100g)}
        </p>
        <button
          type="button"
          className="nutrition-food-favorite"
          aria-label={isFavorite ? 'Remove from favorites' : 'Add to favorites'}
          disabled={busy}
          onClick={() => void handleToggleFavorite(item.id, isFavorite)}
        >
          {isFavorite ? '★' : '☆'}
        </button>
      </li>
    )
  }

  const favoriteIds = new Set(favorites.map((item) => item.id))

  return (
    <div className="nutrition-foods-panel">
      <header className="nutrition-goals-head">
        <h2 className="nutrition-panel-title">Food catalog</h2>
        <p className="nutrition-goals-copy">
          Moss uses USDA Foundation (offline generics), Open Food Facts (branded/barcode), and your custom
          foods. The foundation bundle is ~340 common generics; OFF + live USDA API extend coverage when
          online. Describe always hits local cache first, then OFF/USDA when needed.
        </p>
      </header>

      {message && <p className="nutrition-foods-message">{message}</p>}

      <section className="nutrition-foods-section" aria-label="USDA foundation catalog">
        <h3 className="nutrition-foods-section-title">Generic foods (USDA, offline)</h3>
        <p className="nutrition-foods-section-copy">
          {lookupState && lookupState.usdaFoundationCount > 0
            ? `${lookupState.usdaFoundationCount.toLocaleString()} foundation foods cached locally — Describe resolves apple juice, chicken, rice, etc. without any API key.`
            : 'Import ~340 USDA Foundation foods once (CC0 data). After that, generic Describe matches work offline with no API key.'}
        </p>
        <div className="nutrition-form nutrition-form--inline">
          <MossButton
            disabled={busy}
            onClick={() =>
              void onMutate(async () => {
                const result = await window.moss.nutrition.importUsdaFoundation()
                setMessage(
                  `USDA foundation: ${result.imported} new, ${result.updated} updated (${result.total} in bundle).`
                )
                await loadCatalog()
              })
            }
          >
            {lookupState && lookupState.usdaFoundationCount > 0
              ? 'Refresh foundation foods'
              : 'Import foundation foods'}
          </MossButton>
        </div>
      </section>

      <section className="nutrition-foods-section" aria-label="Packaged foods lookup">
        <h3 className="nutrition-foods-section-title">Packaged foods (Open Food Facts)</h3>
        <p className="nutrition-foods-section-copy">
          No API key — barcode lookup and text search use Open Food Facts. Branded Describe lines (e.g. Little
          Caesars) and barcodes resolve here, then cache locally.
        </p>
      </section>

      <section className="nutrition-foods-section nutrition-foods-section--advanced" aria-label="Optional USDA API">
        <h3 className="nutrition-foods-section-title">Optional: live USDA API</h3>
        <p className="nutrition-foods-section-copy">
          Only needed if you want live search beyond the offline foundation bundle. Use your own free key — never
          shared or embedded in Moss.
        </p>
        <form className="nutrition-form nutrition-form--inline" onSubmit={(event) => void handleSaveApiKey(event)}>
          <input
            type="password"
            className="nutrition-input nutrition-input--wide"
            placeholder="FDC API key"
            value={apiKey}
            onChange={(event) => setApiKey(event.target.value)}
            disabled={busy}
            autoComplete="off"
          />
          <MossButton type="submit" variant="quiet" disabled={busy || !apiKey.trim()}>
            Save key
          </MossButton>
        </form>
      </section>

      <section className="nutrition-foods-section" aria-label="Search foods">
        <h3 className="nutrition-foods-section-title">Search</h3>
        <form className="nutrition-form nutrition-form--inline" onSubmit={(event) => void handleSearch(event)}>
          <input
            type="search"
            className="nutrition-input nutrition-input--wide"
            placeholder="pepperoni pizza, apple juice…"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            disabled={busy || searchBusy}
          />
          <MossButton type="submit" disabled={busy || searchBusy || !searchQuery.trim()}>
            Search
          </MossButton>
        </form>

        {searchResults.length > 0 && (
          <ul className="nutrition-search-results">
            {searchResults.map((result) => (
              <li key={`${result.source}-${result.externalId}`} className="nutrition-search-row">
                <div className="nutrition-search-row-main">
                  <span className="nutrition-search-row-name">{result.name}</span>
                  {result.brand && <span className="nutrition-search-row-brand">{result.brand}</span>}
                  <span className={`nutrition-source-chip nutrition-source-chip--${result.source}`}>
                    {sourceLabel(result.source)}
                  </span>
                </div>
                <p className="nutrition-search-row-macros nutrition-mono">
                  {Math.round(result.kcalPer100g)} kcal/100g
                </p>
                {result.source !== 'manual' && (
                  <MossButton
                    variant="quiet"
                    size="sm"
                    disabled={busy}
                    onClick={() => void handleImportResult(result)}
                  >
                    Import
                  </MossButton>
                )}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section className="nutrition-foods-section" aria-label="Barcode lookup">
        <h3 className="nutrition-foods-section-title">Barcode</h3>
        <form className="nutrition-form nutrition-form--inline" onSubmit={(event) => void handleBarcodeLookup(event)}>
          <input
            type="text"
            inputMode="numeric"
            className="nutrition-input nutrition-input--wide"
            placeholder="UPC / EAN barcode"
            value={barcode}
            onChange={(event) => setBarcode(event.target.value)}
            disabled={busy}
          />
          <MossButton type="submit" variant="quiet" disabled={busy || !barcode.trim()}>
            Look up
          </MossButton>
        </form>
      </section>

      <section className="nutrition-foods-section">
        <button
          type="button"
          className="nutrition-manual-toggle"
          onClick={() => setCreateOpen((open) => !open)}
        >
          {createOpen ? 'Hide custom food form' : 'Add custom food'}
        </button>

        {createOpen && (
          <form className="nutrition-foods-create-form" onSubmit={(event) => void handleCreateFood(event)}>
            <label className="nutrition-field">
              <span className="nutrition-field-label">Name</span>
              <input
                type="text"
                className="nutrition-input"
                value={name}
                onChange={(event) => setName(event.target.value)}
                disabled={busy}
                required
              />
            </label>
            <label className="nutrition-field">
              <span className="nutrition-field-label">Brand (optional)</span>
              <input
                type="text"
                className="nutrition-input"
                value={brand}
                onChange={(event) => setBrand(event.target.value)}
                disabled={busy}
              />
            </label>
            <label className="nutrition-field">
              <span className="nutrition-field-label">kcal per 100g</span>
              <input
                type="number"
                min="1"
                className="nutrition-input"
                value={kcalPer100g}
                onChange={(event) => setKcalPer100g(event.target.value)}
                disabled={busy}
                required
              />
            </label>
            <div className="nutrition-foods-create-macros">
              <label className="nutrition-field">
                <span className="nutrition-field-label">Protein g</span>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  className="nutrition-input nutrition-input--macro"
                  value={proteinPer100g}
                  onChange={(event) => setProteinPer100g(event.target.value)}
                  disabled={busy}
                />
              </label>
              <label className="nutrition-field">
                <span className="nutrition-field-label">Carbs g</span>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  className="nutrition-input nutrition-input--macro"
                  value={carbsPer100g}
                  onChange={(event) => setCarbsPer100g(event.target.value)}
                  disabled={busy}
                />
              </label>
              <label className="nutrition-field">
                <span className="nutrition-field-label">Fat g</span>
                <input
                  type="number"
                  min="0"
                  step="0.1"
                  className="nutrition-input nutrition-input--macro"
                  value={fatPer100g}
                  onChange={(event) => setFatPer100g(event.target.value)}
                  disabled={busy}
                />
              </label>
            </div>
            <fieldset className="nutrition-foods-serving-fieldset">
              <legend className="nutrition-field-label">Default serving (optional)</legend>
              <div className="nutrition-form nutrition-form--inline">
                <input
                  type="text"
                  className="nutrition-input"
                  placeholder="1 slice"
                  value={servingLabel}
                  onChange={(event) => setServingLabel(event.target.value)}
                  disabled={busy}
                />
                <input
                  type="number"
                  min="1"
                  className="nutrition-input nutrition-input--macro"
                  placeholder="grams"
                  value={servingGrams}
                  onChange={(event) => setServingGrams(event.target.value)}
                  disabled={busy}
                />
              </div>
            </fieldset>
            <MossButton type="submit" disabled={busy || !name.trim()}>
              Save food
            </MossButton>
          </form>
        )}
      </section>

      {favorites.length > 0 && (
        <section className="nutrition-foods-section" aria-label="Favorites">
          <h3 className="nutrition-foods-section-title">Favorites</h3>
          <ul className="nutrition-food-list">{favorites.map((item) => renderFoodRow(item, favoriteIds))}</ul>
        </section>
      )}

      {recents.length > 0 && (
        <section className="nutrition-foods-section" aria-label="Recent foods">
          <h3 className="nutrition-foods-section-title">Recent</h3>
          <ul className="nutrition-food-list">{recents.map((item) => renderFoodRow(item, favoriteIds))}</ul>
        </section>
      )}

      <footer className="nutrition-data-attribution">
        <p className="m-0">
          Data sources: USDA FoodData Central (CC0 foundation foods, cached locally) · Open Food Facts (OdBL,
          barcode + text search). No cloud account; lookup results cache on this device.
        </p>
      </footer>
    </div>
  )
}
