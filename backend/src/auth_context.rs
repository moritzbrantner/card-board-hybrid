use crate::identity::AccountProfile;
use crate::*;
use axum::http::{HeaderMap, header};

pub(crate) fn bearer_token_from_headers(headers: &HeaderMap) -> Option<String> {
    let value = headers.get(header::AUTHORIZATION)?.to_str().ok()?;
    value
        .strip_prefix("Bearer ")
        .filter(|token| !token.trim().is_empty())
        .map(str::to_string)
}

#[allow(
    clippy::result_large_err,
    reason = "route helpers return Axum responses directly"
)]
pub(crate) fn optional_profile_from_headers(
    state: &SharedState,
    headers: &HeaderMap,
) -> Result<Option<AccountProfile>, axum::response::Response> {
    let Some(token) = bearer_token_from_headers(headers) else {
        return Ok(None);
    };

    let profile = {
        let mut store = state
            .store
            .lock()
            .expect("store lock should not be poisoned");
        let identity = IdentityModule::new(store.connection_mut());
        match identity.current_profile(&token) {
            Ok(profile) => profile,
            Err(error) => return Err(identity_error_response(error)),
        }
    };

    profile.map(Some).ok_or_else(unauthorized_response)
}

#[allow(
    clippy::result_large_err,
    reason = "route helpers return Axum responses directly"
)]
pub(crate) fn required_profile_from_headers(
    state: &SharedState,
    headers: &HeaderMap,
) -> Result<AccountProfile, axum::response::Response> {
    optional_profile_from_headers(state, headers)?.ok_or_else(unauthorized_response)
}
