from __future__ import annotations
import json
from dataclasses import dataclass
from typing import Optional, Dict, Any
from urllib import request, parse


@dataclass
class RepoTokenizerClient:
    base_url: str
    headers: Optional[Dict[str, str]] = None

    def _request(self, path: str) -> Any:
        url = f"{self.base_url}{path}"
        req = request.Request(url, headers=self.headers or {})
        with request.urlopen(req) as resp:  # nosec - consumer should secure transport
            if resp.status >= 400:
                raise RuntimeError(f"Request failed: {resp.status}")
            data = resp.read().decode("utf-8")
            if not data:
                return None
            return json.loads(data)

    def list_files(self, include: Optional[str] = None, exclude: Optional[str] = None, ref: Optional[str] = None) -> Any:
        params = {k: v for k, v in {"include": include, "exclude": exclude, "ref": ref}.items() if v}
        query = f"?{parse.urlencode(params)}" if params else ""
        return self._request(f"/files{query}")

    def list_chunks(self, path: Optional[str] = None, lang: Optional[str] = None, ref: Optional[str] = None, max_tokens: Optional[int] = None) -> Any:
        params = {k: v for k, v in {
            "path": path,
            "lang": lang,
            "ref": ref,
            "maxTokens": max_tokens,
        }.items() if v is not None}
        query = f"?{parse.urlencode(params)}" if params else ""
        return self._request(f"/chunks{query}")

    def get_file(self, path: str, ref: Optional[str] = None) -> Any:
        params = {"path": path}
        if ref:
            params["ref"] = ref
        query = f"?{parse.urlencode(params)}"
        return self._request(f"/file{query}")

    def get_chunk(self, chunk_id: str, ref: Optional[str] = None) -> Any:
        query = f"?ref={parse.quote(ref)}" if ref else ""
        return self._request(f"/chunks/{parse.quote(chunk_id)}{query}")

    def search(self, query_text: str, path_glob: Optional[str] = None, ref: Optional[str] = None) -> Any:
        params = {"q": query_text}
        if path_glob:
            params["pathGlob"] = path_glob
        if ref:
            params["ref"] = ref
        query = f"?{parse.urlencode(params)}"
        return self._request(f"/search{query}")

    def search_symbols(self, query_text: Optional[str] = None, ref: Optional[str] = None) -> Any:
        params = {}
        if query_text:
            params["q"] = query_text
        if ref:
            params["ref"] = ref
        query = f"?{parse.urlencode(params)}" if params else ""
        return self._request(f"/search/symbols{query}")
