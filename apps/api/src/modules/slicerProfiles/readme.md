# slicerProfiles Nest domain

The domain owns only `slicer_profile_calibrations`. Reads of the unowned profile/catalog tables and
foreign model/make aggregates enter through the lookup adapter supplied to
`SlicerProfilesModule.register(...)`; this keeps physical cross-domain SQL outside the domain.

The module exports only `SLICER_PROFILES_PORT`. Its repository, mesh client, rate limiter, and lookup
input token remain private providers.
