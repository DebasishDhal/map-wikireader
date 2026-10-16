import './App.css';
import WikiMap from './components/Map';
import React, { useCallback, useEffect, useRef, useState } from 'react';

const API = (process.env.REACT_APP_BACKEND_URL || 'http://localhost:8004').replace(/\/$/, '');
const AUTH_KEY = 'map-wikireader-session';
const cognito = {
  domain: process.env.REACT_APP_COGNITO_DOMAIN,
  clientId: process.env.REACT_APP_COGNITO_CLIENT_ID,
  redirect: process.env.REACT_APP_COGNITO_REDIRECT_URI || window.location.origin,
};

function readSession() {
  try { return JSON.parse(sessionStorage.getItem(AUTH_KEY) || 'null'); } catch { return null; }
}

function App() {
  const [searchQuery, setSearchQuery] = useState('');
  const [submittedQuery, setSubmittedQuery] = useState('');
  const [contentType, setContentType] = useState('summary');
  const [session, setSession] = useState(readSession);
  const [profile, setProfile] = useState(null);
  const [panel, setPanel] = useState('');
  const [notice, setNotice] = useState('');
  const [toast, setToast] = useState(null);
  const toastTimer = useRef(null);
  const [visibility, setVisibility] = useState('private');
  const [collectionChoices, setCollectionChoices] = useState({});
  const [sharedLocations, setSharedLocations] = useState([]);
  const [sharedListName, setSharedListName] = useState('');
  const [selectedList, setSelectedList] = useState(null);

  const showToast = (message, type) => {
    window.clearTimeout(toastTimer.current);
    setToast({ message, type });
    toastTimer.current = window.setTimeout(() => setToast(null), 4000);
  };

  useEffect(() => () => window.clearTimeout(toastTimer.current), []);

  const api = useCallback(async (path, options = {}) => {
    const response = await fetch(`${API}${path}`, {
      ...options,
      headers: { ...(options.body ? { 'Content-Type': 'application/json' } : {}),
        ...(session?.idToken ? { Authorization: `Bearer ${session.idToken}` } : {}), ...options.headers },
    });
    if (!response.ok) throw new Error((await response.json().catch(() => ({}))).detail || 'Request failed');
    return response.json();
  }, [session]);

  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const authError = params.get('error');
    if (authError) {
      const description = params.get('error_description');
      params.delete('error');
      params.delete('error_description');
      params.delete('state');
      const query = params.toString();
      window.history.replaceState(null, '', `${window.location.pathname}${query ? `?${query}` : ''}${window.location.hash}`);
      setNotice(description || `Sign-in failed (${authError}). Please check your Cognito app client settings.`);
      return;
    }
    const code = params.get('code');
    if (!code) return;
    const expectedState = sessionStorage.getItem('map-wikireader-oauth-state');
    const verifier = sessionStorage.getItem('map-wikireader-pkce-verifier');
    const state = params.get('state');
    sessionStorage.removeItem('map-wikireader-oauth-state');
    sessionStorage.removeItem('map-wikireader-pkce-verifier');
    window.history.replaceState(null, '', window.location.pathname);
    if (!expectedState || state !== expectedState || !verifier || !cognito.domain || !cognito.clientId) {
      setNotice('Sign-in could not be verified. Please try again.'); return;
    }
    fetch(`${API}/api/auth/token`, { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ code, code_verifier: verifier }) })
      .then(async (response) => { const result = await response.json(); if (!response.ok) throw new Error(result.detail || result.error_description || 'Sign-in failed'); return result; })
      .then((tokens) => {
        const next = { idToken: tokens.id_token, accessToken: tokens.access_token,
          expiresAt: Date.now() + Number(tokens.expires_in || 3600) * 1000 };
        sessionStorage.setItem(AUTH_KEY, JSON.stringify(next)); setSession(next);
      }).catch((error) => setNotice(error.message));
  }, []);

  useEffect(() => {
    if (!session?.idToken) { setProfile(null); return; }
    api('/api/me').then(setProfile).catch((error) => {
      setNotice(error.message);
      sessionStorage.removeItem(AUTH_KEY);
      setSession(null);
    });
  }, [api, session?.idToken]);

  useEffect(() => {
    const listId = new URLSearchParams(window.location.search).get('list');
    if (listId) fetch(`${API}/api/public/lists/${encodeURIComponent(listId)}`).then((r) => r.ok ? r.json() : Promise.reject(new Error('This public collection is unavailable.')))
      .then((list) => { setSharedLocations(list.locations || []); setSharedListName(list.name); })
      .catch((e) => setNotice(e.message));
  }, []);

  const signIn = async () => {
    if (!cognito.domain || !cognito.clientId) {
      setNotice('Add the Cognito domain and app client ID to the frontend environment to enable sign in.');
      return;
    }
    try {
      if (!window.crypto?.subtle) {
        throw new Error('Sign in requires a secure page. Open the app on localhost or use its HTTPS address.');
      }
      const random = (length) => { const bytes = new Uint8Array(length); window.crypto.getRandomValues(bytes); return btoa(String.fromCharCode(...bytes)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, ''); };
      const verifier = random(32);
      const challengeBytes = await window.crypto.subtle.digest('SHA-256', new TextEncoder().encode(verifier));
      const challenge = btoa(String.fromCharCode(...new Uint8Array(challengeBytes))).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
      const state = random(24);
      sessionStorage.setItem('map-wikireader-oauth-state', state);
      sessionStorage.setItem('map-wikireader-pkce-verifier', verifier);
      const url = new URL(`https://${cognito.domain.replace(/^https?:\/\//, '')}/oauth2/authorize`);
      url.search = new URLSearchParams({ response_type: 'code', client_id: cognito.clientId,
        redirect_uri: cognito.redirect, scope: 'openid', state,
        code_challenge_method: 'S256', code_challenge: challenge }).toString();
      window.location.assign(url.toString());
    } catch (error) {
      setNotice(error.message || 'Could not start sign-in. Please reload the app and try again.');
    }
  };

  const signOut = () => {
    sessionStorage.removeItem(AUTH_KEY);
    setSession(null); setProfile(null);
    if (cognito.domain && cognito.clientId) {
      const url = `https://${cognito.domain.replace(/^https?:\/\//, '')}/logout?${new URLSearchParams({ client_id: cognito.clientId, logout_uri: cognito.redirect })}`;
      window.location.assign(url);
    }
  };

  const handleSearch = async (event) => {
    event.preventDefault();
    const query = searchQuery.trim();
    if (!query) return;
    setSubmittedQuery(query);
    if (session) {
      try {
        await api('/api/searches', { method: 'POST', body: JSON.stringify({ query, search_type: contentType }) });
        const [searches, fresh] = await Promise.all([api('/api/searches'), api('/api/me')]);
        setProfile({ ...fresh, searches });
      } catch (error) { setNotice(error.message); }
    }
  };

  const saveLocation = async (place) => {
    if (!session) { showToast('Sign in to save locations.', 'error'); return; }
    let location;
    try {
      location = await api('/api/locations', { method: 'POST', body: JSON.stringify({ ...place, visibility }) });
    } catch (error) {
      showToast(`Could not save location: ${error.message}`, 'error');
      return;
    }

    const targetList = profile?.lists?.find((list) => list.is_default);
    let collectionError = null;
    if (targetList) {
      try {
        await api(`/api/lists/${targetList.id}/locations`, { method: 'POST', body: JSON.stringify({ location_id: location.id }) });
      } catch (error) {
        collectionError = error;
      }
    }

    try { setProfile(await api('/api/me')); } catch (error) { setNotice(error.message); }
    if (collectionError) {
      showToast(`Location saved, but could not add it to ${targetList.name}: ${collectionError.message}`, 'error');
    } else {
      showToast(targetList ? `Location saved to ${targetList.name}.` : 'Location saved.', 'success');
    }
  };

  const toggleLocationInList = async (place, listId) => {
    if (!listId) return;
    const list = profile?.lists?.find((item) => item.id === listId);
    const isInList = (place.list_ids || []).includes(listId);
    try {
      if (isInList) {
        await api(`/api/lists/${listId}/locations/${place.id}`, { method: 'DELETE' });
        showToast(`Removed from ${list?.name || 'collection'}.`, 'success');
      } else {
        await api(`/api/lists/${listId}/locations`, { method: 'POST', body: JSON.stringify({ location_id: place.id }) });
        showToast(`Added to ${list?.name || 'collection'}.`, 'success');
      }
      setProfile(await api('/api/me'));
    } catch (error) {
      showToast(error.message || 'Could not update the collection.', 'error');
    }
  };

  const updateSearchCount = useCallback(async (query, resultCount) => {
    if (!session) return;
    try { await api(`/api/searches/latest?${new URLSearchParams({ query, result_count: String(resultCount) })}`, { method: 'PATCH' }); }
    catch (error) { setNotice(error.message); }
  }, [api, session]);

  const createCollection = async (event) => {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    try {
      await api('/api/lists', { method: 'POST', body: JSON.stringify({ name: form.get('name'), description: form.get('description') || '', visibility: form.get('visibility') }) });
      setProfile(await api('/api/me')); event.currentTarget.reset();
    } catch (error) { setNotice(error.message); }
  };

  return <div className="App">
    <header className="app-bar">
      <a className="brand" href="/">Map WikiReader</a>
      <form className="search-container" onSubmit={handleSearch}>
        <input aria-label="Search Wikipedia" placeholder="Search for a location" value={searchQuery} onChange={(e) => setSearchQuery(e.target.value)} />
        <select aria-label="Content type" value={contentType} onChange={(e) => setContentType(e.target.value)}>
          <option value="summary">Summary</option><option value="full">Full Content</option>
        </select>
        <button type="submit">Search</button>
      </form>
      {session ? <div className="account-actions"><span>{profile?.user?.display_name || profile?.user?.email || 'Signed in'}</span>
        <button onClick={() => setPanel(panel ? '' : 'saved')}>My places</button><button className="quiet-button" onClick={signOut}>Sign out</button></div>
        : <button type="button" onClick={signIn}>Sign in</button>}
    </header>
    {notice && <div className="notice" role="status">{notice}<button onClick={() => setNotice('')} aria-label="Dismiss">×</button></div>}
    {toast && <div className={`toast toast-${toast.type}`} role={toast.type === 'error' ? 'alert' : 'status'} aria-live={toast.type === 'error' ? 'assertive' : 'polite'}>
      <span>{toast.message}</span><button onClick={() => { window.clearTimeout(toastTimer.current); setToast(null); }} aria-label="Dismiss notification">×</button>
    </div>}
    {sharedListName && <div className="shared-banner">Viewing public collection: <strong>{sharedListName}</strong></div>}
    {panel === 'saved' && <aside className="saved-panel">
      <button className="close-panel" onClick={() => setPanel('')}>Close</button><h2>Your places</h2>
      {!profile ? <p>Loading saved data…</p> : <>
        <h3>Collections</h3>{profile.lists.map((list) => {
          const listLocations = (profile.locations || []).filter((place) => (place.list_ids || []).includes(list.id));
          return <section className="collection-card" key={list.id}>
            <div className="list-row"><strong>{list.name}{list.is_default ? ' · Favorites' : ''}</strong><span>{list.visibility}</span>
              <button onClick={async () => { try { setSelectedList(await api(`/api/lists/${list.id}`)); } catch (e) { setNotice(e.message); } }}>Manage</button>
              {!list.is_default && <select aria-label={`Visibility for ${list.name}`} value={list.visibility} onChange={async (e) => { try { await api(`/api/lists/${list.id}`, { method: 'PATCH', body: JSON.stringify({ name: list.name, description: list.description, visibility: e.target.value }) }); setProfile(await api('/api/me')); } catch (error) { setNotice(error.message); } }}><option value="private">Private</option><option value="public">Public</option></select>}
              {list.visibility === 'public' && <button onClick={() => { navigator.clipboard?.writeText(`${window.location.origin}/?list=${list.id}`); setNotice('Public collection link copied.'); }}>Share</button>}
            </div>
            {listLocations.length ? listLocations.map((place) => <div className="collection-place" key={place.id}>{place.title}</div>) : <p className="collection-empty">No places in this collection yet.</p>}
          </section>;
        })}
        <form className="collection-form" onSubmit={createCollection}><h3>New collection</h3><input name="name" placeholder="Collection name" required/><input name="description" placeholder="Description"/><select name="visibility"><option value="private">Private</option><option value="public">Public</option></select><button>Create</button></form>
        <label className="visibility-choice">New saved locations <select value={visibility} onChange={(e) => setVisibility(e.target.value)}><option value="private">Private</option><option value="public">Public</option></select></label>
        {selectedList && <section className="selected-list">
          <h3>{selectedList.name} · {selectedList.locations.length} places</h3>
          {selectedList.locations.map((place, index) => <div className="selected-list-item" key={place.id}>
            <div className="list-row">
              <strong>{index + 1}. {place.title}</strong>
              <button disabled={index === 0} onClick={async () => { const ids = selectedList.locations.map((p) => p.id); [ids[index - 1], ids[index]] = [ids[index], ids[index - 1]]; await api(`/api/lists/${selectedList.id}/locations/order`, { method: 'PUT', body: JSON.stringify({ location_ids: ids }) }); setSelectedList(await api(`/api/lists/${selectedList.id}`)); }}>↑</button>
              <button disabled={index === selectedList.locations.length - 1} onClick={async () => { const ids = selectedList.locations.map((p) => p.id); [ids[index], ids[index + 1]] = [ids[index + 1], ids[index]]; await api(`/api/lists/${selectedList.id}/locations/order`, { method: 'PUT', body: JSON.stringify({ location_ids: ids }) }); setSelectedList(await api(`/api/lists/${selectedList.id}`)); }}>↓</button>
              <button onClick={async () => { await api(`/api/lists/${selectedList.id}/locations/${place.id}`, { method: 'DELETE' }); setSelectedList(await api(`/api/lists/${selectedList.id}`)); setProfile(await api('/api/me')); }}>Remove</button>
            </div>
            <textarea className="list-note-editor" aria-label={`Note for ${place.title} in ${selectedList.name}`} placeholder="Add a note for this collection" value={place.list_note || ''} onChange={(event) => setSelectedList((current) => ({ ...current, locations: current.locations.map((item) => item.id === place.id ? { ...item, list_note: event.target.value } : item) }))} />
            <button className="save-list-note" onClick={async () => { try { await api(`/api/lists/${selectedList.id}/locations`, { method: 'POST', body: JSON.stringify({ location_id: place.id, note: place.list_note || '' }) }); setSelectedList(await api(`/api/lists/${selectedList.id}`)); showToast('List note saved.', 'success'); } catch (error) { showToast(error.message || 'Could not save the list note.', 'error'); } }}>Save note</button>
          </div>)}
        </section>}
        <h3>Saved locations</h3>{(profile.locations || []).map((place) => {
          const chosenListId = collectionChoices[place.id] || '';
          const alreadyInList = (place.list_ids || []).includes(chosenListId);
          return <div className="list-row" key={place.id}>
            <span><strong>{place.title}</strong><small>{place.visibility} · {place.description || 'No note'}</small></span>
            <select aria-label={`Choose collection for ${place.title}`} value={chosenListId} onChange={(event) => setCollectionChoices((choices) => ({ ...choices, [place.id]: event.target.value }))}>
              <option value="">Choose collection…</option>{profile.lists.map((list) => <option key={list.id} value={list.id}>{list.name}</option>)}
            </select>
            <button disabled={!chosenListId} onClick={() => toggleLocationInList(place, chosenListId)}>{alreadyInList ? 'Remove' : 'Add'}</button>
          </div>;
        })}
        <h3>Recent searches</h3>{(profile.searches || []).map((s) => <button className="history-row" key={s.id} onClick={() => { setSearchQuery(s.query); setSubmittedQuery(s.query); setPanel(''); }}>{s.query}<small>{new Date(s.created_at).toLocaleString()}</small></button>)}
        <h3>Activity</h3>{(profile.activities || []).slice(0, 12).map((a) => <p className="activity-row" key={a.id}>{a.activity_type.replaceAll('_', ' ')} <small>{new Date(a.created_at).toLocaleString()}</small></p>)}
      </>}
    </aside>}
    <WikiMap onMapClick={() => {}} searchQuery={submittedQuery} contentType={contentType} setSearchQuery={setSearchQuery} setSubmittedQuery={setSubmittedQuery}
      onSaveLocation={saveLocation} onSearchResults={updateSearchCount} isSignedIn={!!session} sharedLocations={sharedLocations} />
  </div>;
}

export default App;
