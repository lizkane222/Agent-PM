from rest_framework.pagination import PageNumberPagination


class ClientPageSizePagination(PageNumberPagination):
    """PageNumberPagination that lets the caller widen the page via ?page_size=.

    The project default (core.settings.REST_FRAMEWORK) is bare PageNumberPagination
    with PAGE_SIZE 50 and no page_size_query_param, so ?page_size= is silently
    ignored there. Attach this class to a viewset whose callers need the full list
    in one request. Response shape is unchanged — still the DRF envelope.
    """

    page_size_query_param = "page_size"
    max_page_size = 1000
