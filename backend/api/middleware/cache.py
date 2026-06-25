import redis
import json
import logging
from config import REDIS_URL

logger = logging.getLogger(__name__)

try:
    _client = redis.from_url(REDIS_URL, decode_responses=True, socket_connect_timeout=2)
    _client.ping()
    _AVAILABLE = True
    logger.info("✅ Redis conectado — cache ativo")
except Exception as e:
    _AVAILABLE = False
    logger.warning(f"⚠️ Redis indisponível, cache desabilitado: {e}")


def get_or_cache(key: str, ttl: int, fn):
    """
    Tenta retornar o valor do cache Redis.
    Se ausente, chama fn(), armazena o resultado e o retorna.
    Degrada graciosamente se o Redis estiver fora.
    """
    if not _AVAILABLE:
        return fn()
    try:
        cached = _client.get(key)
        if cached:
            return json.loads(cached)
        result = fn()
        _client.setex(key, ttl, json.dumps(result, default=str))
        return result
    except Exception as exc:
        logger.warning(f"Cache erro ({key}): {exc}")
        return fn()


def invalidar_padrao(padrao: str = "cache:*"):
    """Remove chaves de cache que casem com o padrão dado."""
    if not _AVAILABLE:
        return
    try:
        keys = _client.keys(padrao)
        if keys:
            _client.delete(*keys)
            logger.info(f"Cache invalidado: {len(keys)} chave(s) removida(s)")
    except Exception as exc:
        logger.warning(f"Falha ao invalidar cache: {exc}")
