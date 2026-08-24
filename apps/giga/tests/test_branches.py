from giga.branches import BRANCHES, get_executor


def test_all_branches_registered():
    assert set(BRANCHES) == {"openscad", "kzd", "hueforge", "trellis", "concepts", "scan"}


def test_get_executor_unknown_branch_raises_key_error():
    try:
        get_executor("unknown")
    except KeyError:
        pass
    else:
        raise AssertionError("expected KeyError for unknown branch")
