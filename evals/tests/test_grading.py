from __future__ import annotations

import pytest

from search_evals.grading import (
    answer_language,
    citations,
    grade,
    normalize,
    numbers_not_in,
    refused,
    says,
)


class TestNormalize:
    @pytest.mark.parametrize(
        ("text", "expected"),
        [
            ("1,900 euros", "1900 euros"),
            ("1.900 euros", "1900 euros"),
            ("1 900 euros", "1900 euros"),
            ("25.000 euros", "25000 euros"),
            ("86,40 euros", "86.40 euros"),
            ("6,1 ммоль/л", "6.1 ммоль/л"),
            ("900 112 233", "900112233"),
            ("Свёкла", "свекла"),
            ("Your files don’t say.", "your files don't say."),
            ("a b   c", "a b c"),
        ],
    )
    def test_writes_each_number_one_way(self, text: str, expected: str) -> None:
        assert normalize(text) == expected

    def test_leaves_a_list_of_numbers_alone(self) -> None:
        # A comma with a space after it separates; only one between digits is a decimal.
        assert normalize("1, 2 and 3") == "1, 2 and 3"


class TestSays:
    def test_matches_whole_words(self) -> None:
        assert says("It costs 950 euros.", ["950"])
        assert not says("It costs 1950 euros.", ["950"])
        assert not says("Всегда можно.", ["да"])

    def test_a_star_matches_a_stem(self) -> None:
        assert says("Из-за электрического отопления.", ["отоплен*"])
        assert not says("Из-за электрического отопления.", ["отоплен"])

    def test_any_alternative_will_do(self) -> None:
        assert says("Departs 09:35.", ["9:35", "09:35"])
        assert not says("Departs 09:35.", ["9:35"])

    def test_numbers_written_differently_are_the_same(self) -> None:
        assert says("The deposit was 1.900 €", ["1,900"])
        assert says("Pagaste 86.40 euros", ["86,40"])


class TestRefused:
    @pytest.mark.parametrize(
        "answer",
        [
            "Your files don't say.",
            "Your files don’t say.",
            "Sus archivos no lo dicen.",
            "В ваших файлах этого нет.",
            "В ваших файлах этого нет, но обычно это 30 дней.",
        ],
    )
    def test_knows_the_three_sentences(self, answer: str) -> None:
        assert refused(answer)

    def test_an_answer_is_not_a_refusal(self) -> None:
        assert not refused("The rent is 950 euros [1].")


class TestCitations:
    def test_each_number_once_in_the_order_first_cited(self) -> None:
        assert citations("A [2]. B [1][2]. C [3], [1].") == [2, 1, 3]

    def test_only_what_the_screen_links(self) -> None:
        # Ask.tsx turns [n] into a link and leaves "[1, 2]" as text.
        assert citations("Both say so [1, 2].") == []

    def test_none(self) -> None:
        assert citations("Your files don't say.") == []


class TestNumbersNotIn:
    def test_a_number_the_excerpts_state_is_supported(self) -> None:
        assert numbers_not_in("It is 86,40 euros [1].", ["Importe total a pagar: 86,40 euros"]) == []

    def test_an_invented_number_is_listed(self) -> None:
        assert numbers_not_in("It is 96,40 euros [1].", ["Importe total a pagar: 86,40 euros"]) == ["96.4"]

    def test_citations_are_not_numbers(self) -> None:
        assert numbers_not_in("Yes [7].", ["Nothing numeric."]) == []

    def test_a_time_with_or_without_its_leading_zero(self) -> None:
        assert numbers_not_in("At 9:35.", ["departs 09:35"]) == []

    def test_a_date_written_with_points_counts_by_its_parts(self) -> None:
        assert numbers_not_in("Until 31.1.2027.", ["31 January 2027, month 1"]) == []


class TestAnswerLanguage:
    @pytest.mark.parametrize(
        ("answer", "expected"),
        [
            ("950 евро в месяц [1].", "ru"),
            ("The rent is 950 euros [1].", "en"),
            ("Pagaste 86,40 euros por la luz [1].", "es"),
            # Spanish words quoted in an English answer do not make it Spanish.
            ("The bill says the total is 86,40 euros under Importe total [1].", "en"),
            ("K7QX2M [1].", None),
            ("[1]", None),
        ],
    )
    def test_tells_the_language(self, answer: str, expected: str | None) -> None:
        assert answer_language(answer) == expected


class TestGrade:
    EXCERPTS = [
        "Ежемесячная арендная плата составляет 950 (девятьсот пятьдесят) евро.",
        "Importe total a pagar: 86,40 euros",
    ]
    QUOTES = ["Ежемесячная арендная плата составляет 950 (девятьсот пятьдесят) евро."]
    FACTS = [["950"]]

    def test_a_good_answer(self) -> None:
        g = grade("950 евро в месяц [1].", "Сколько я плачу за аренду?", self.FACTS, self.QUOTES, self.EXCERPTS)
        assert g.correct and not g.refused
        assert (g.facts_said, g.facts) == (1, 1)
        assert g.cited == (1,)
        assert g.evidence_cited == 1.0
        assert g.citation_precision == 1.0
        assert g.numbers_not_in_excerpts == ()
        assert g.language == "ru"

    def test_citing_the_wrong_piece(self) -> None:
        g = grade("950 евро [2].", "Сколько?", self.FACTS, self.QUOTES, self.EXCERPTS)
        assert g.correct  # the facts are right…
        assert g.evidence_cited == 0.0  # …and the citation points at the bill
        assert g.citation_precision == 0.0

    def test_half_the_citations_right(self) -> None:
        g = grade("950 евро [1][2].", "Сколько?", self.FACTS, self.QUOTES, self.EXCERPTS)
        assert g.citation_precision == 0.5

    def test_a_citation_past_the_last_piece(self) -> None:
        g = grade("950 евро [9].", "Сколько?", self.FACTS, self.QUOTES, self.EXCERPTS)
        assert g.citations_out_of_range == 1
        assert g.citation_precision == 0.0

    def test_a_refusal_where_there_is_an_answer(self) -> None:
        g = grade("В ваших файлах этого нет.", "Сколько?", self.FACTS, self.QUOTES, self.EXCERPTS)
        assert g.refused and not g.correct
        assert g.evidence_cited is None
        assert g.citation_precision is None

    def test_a_refusal_where_there_is_none(self) -> None:
        g = grade("Your files don't say.", "What is my landlord's phone?", [], [], self.EXCERPTS)
        assert g.refused and g.correct
        assert g.evidence_cited is None

    def test_an_answer_where_there_is_none(self) -> None:
        g = grade("It is 600 123 456 [1].", "What is my landlord's phone?", [], [], self.EXCERPTS)
        assert not g.correct
        assert g.numbers_not_in_excerpts == ("600123456",)
        # Nothing was to be cited, so there is nothing to be precise about.
        assert g.citation_precision is None

    def test_a_number_from_the_question_is_not_invented(self) -> None:
        g = grade("Release 3.4 ships on 21 April.", "When does release 3.4 ship?", [["21 april"]], ["x"], ["on 21 April"])
        assert g.numbers_not_in_excerpts == ()
